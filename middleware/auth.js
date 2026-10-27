/**
 * Authentication Middleware
 * 
 * Verifies Azure AD JWT tokens for protected API routes.
 * Uses JWKS (JSON Web Key Set) to validate token signatures.
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger = require('../utils/logger');

// Configuration
const AZURE_AD_TENANT_ID = process.env.AZURE_AD_TENANT_ID;
const AZURE_AD_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID;

// JWKS client for fetching Microsoft's public keys
let client = null;

/**
 * Initialize JWKS client lazily (only when needed)
 */
function getJwksClient() {
    if (!client && AZURE_AD_TENANT_ID) {
        client = jwksClient({
            jwksUri: `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/discovery/v2.0/keys`,
            cache: true,
            cacheMaxAge: 86400000, // 24 hours
            rateLimit: true,
            jwksRequestsPerMinute: 10
        });
    }
    return client;
}

/**
 * Get signing key from JWKS
 */
function getSigningKey(header, callback) {
    const jwks = getJwksClient();
    if (!jwks) {
        return callback(new Error('JWKS client not configured'));
    }
    
    jwks.getSigningKey(header.kid, (err, key) => {
        if (err) {
            logger.error('Error fetching signing key:', err);
            return callback(err);
        }
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
    });
}

/**
 * Verify JWT token options
 */
function getVerifyOptions() {
    return {
        algorithms: ['RS256'],
        issuer: [
            `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/v2.0`,
            `https://sts.windows.net/${AZURE_AD_TENANT_ID}/`
        ],
        audience: AZURE_AD_CLIENT_ID
    };
}

/**
 * Extract token from Authorization header
 */
function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return null;
    }
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return null;
    }
    
    return parts[1];
}

/**
 * Authentication middleware - requires valid token
 * 
 * Usage: app.use('/api/protected', authenticate, protectedRoutes)
 */
function authenticate(req, res, next) {
    // Skip authentication if Azure AD is not configured
    if (!AZURE_AD_TENANT_ID || !AZURE_AD_CLIENT_ID) {
        logger.warn('Azure AD not configured - authentication disabled');
        req.user = { authenticated: false, reason: 'auth_not_configured' };
        return next();
    }
    
    const token = extractToken(req);
    
    if (!token) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'NO_TOKEN'
        });
    }
    
    jwt.verify(token, getSigningKey, getVerifyOptions(), (err, decoded) => {
        if (err) {
            logger.error('Token verification failed:', err.message);
            
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({
                    error: 'Token expired',
                    code: 'TOKEN_EXPIRED'
                });
            }
            
            return res.status(401).json({
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }
        
        // Attach user info to request
        req.user = {
            authenticated: true,
            id: decoded.oid || decoded.sub, // Object ID or Subject
            email: decoded.email || decoded.preferred_username || decoded.upn,
            name: decoded.name,
            roles: decoded.roles || [],
            groups: decoded.groups || [],
            rawToken: decoded
        };
        
        logger.info(`Authenticated user: ${req.user.email}`);
        next();
    });
}

/**
 * Verify a token outside an Express request (used for websockets).
 * Resolves with the decoded claims; rejects when the token is expired, forged or not meant for this app.
 */
function verifyToken(token) {
    return new Promise((resolve, reject) => {
        if (!AZURE_AD_TENANT_ID || !AZURE_AD_CLIENT_ID) {
            return reject(new Error('Azure AD not configured'));
        }
        jwt.verify(token, getSigningKey, getVerifyOptions(), (err, decoded) => (err ? reject(err) : resolve(decoded)));
    });
}

/**
 * Optional authentication middleware - doesn't require token but attaches user if present
 * 
 * Usage: app.use('/api/optional', optionalAuth, routes)
 */
function optionalAuth(req, res, next) {
    // Skip if Azure AD not configured
    if (!AZURE_AD_TENANT_ID || !AZURE_AD_CLIENT_ID) {
        req.user = { authenticated: false, reason: 'auth_not_configured' };
        return next();
    }
    
    const token = extractToken(req);
    
    if (!token) {
        req.user = { authenticated: false, reason: 'no_token' };
        return next();
    }
    
    jwt.verify(token, getSigningKey, getVerifyOptions(), (err, decoded) => {
        if (err) {
            logger.warn('Token verification failed:', err.message);
            req.user = { authenticated: false, reason: 'invalid_token', error: err.message };
            return next();
        }
        
        req.user = {
            authenticated: true,
            id: decoded.oid || decoded.sub,
            email: decoded.email || decoded.preferred_username || decoded.upn,
            name: decoded.name,
            roles: decoded.roles || [],
            groups: decoded.groups || [],
            rawToken: decoded
        };
        
        logger.debug('User authenticated:', req.user.email);
        next();
    });
}

/**
 * Role-based authorization middleware
 * 
 * Usage: app.use('/api/admin', authenticate, requireRole('Admin'), adminRoutes)
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !req.user.authenticated) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'NOT_AUTHENTICATED'
            });
        }
        
        const userRoles = req.user.roles || [];
        const hasRole = allowedRoles.some(role => userRoles.includes(role));
        
        if (!hasRole) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                code: 'FORBIDDEN',
                required: allowedRoles
            });
        }
        
        next();
    };
}

/**
 * Check if user has specific role
 */
function hasRole(req, role) {
    return req.user && req.user.roles && req.user.roles.includes(role);
}

module.exports = {
    authenticate,
    optionalAuth,
    requireRole,
    hasRole,
    extractToken,
    verifyToken
};

