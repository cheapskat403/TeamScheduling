/**
 * Route-level Authentication Middleware
 * 
 * Protects write operations (POST, PUT, DELETE) while allowing read operations.
 * Designed to be used with optionalAuth at the app level.
 */

const logger = require('../utils/logger');

// Configuration - set to true to enforce authentication on write operations
const REQUIRE_AUTH_FOR_WRITES = process.env.REQUIRE_AUTH === 'true';

/**
 * Middleware that requires authentication for write operations
 * Read operations (GET, HEAD, OPTIONS) are allowed without authentication
 */
function requireAuthForWrites(req, res, next) {
    // Allow read operations without authentication
    const readMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (readMethods.includes(req.method)) {
        return next();
    }
    
    // Skip auth requirement if not enabled
    if (!REQUIRE_AUTH_FOR_WRITES) {
        logger.debug(`Auth not required (REQUIRE_AUTH=${process.env.REQUIRE_AUTH})`);
        return next();
    }
    
    // Check if user is authenticated
    if (!req.user || !req.user.authenticated) {
        logger.warn(`Unauthorized write attempt: ${req.method} ${req.originalUrl}`, {
            hasUser: !!req.user,
            authenticated: req.user?.authenticated,
            reason: req.user?.reason,
            error: req.user?.error,
            hasAuthHeader: !!req.headers.authorization
        });
        return res.status(401).json({
            error: 'Authentication required for this operation',
            code: 'AUTH_REQUIRED'
        });
    }
    
    // User is authenticated, proceed
    logger.debug(`Authenticated request: ${req.method} ${req.originalUrl} by ${req.user.email}`);
    next();
}

/**
 * Middleware that always requires authentication (for admin routes)
 */
function requireAuth(req, res, next) {
    if (!req.user || !req.user.authenticated) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }
    next();
}

/**
 * Paths under /api that stay readable without logging in, because the people using them cannot sign
 * in: the QR check-in page is opened from a sticker on a desk and shows the desk and who booked it
 * today. They are matched against the path relative to /api, and only for GET.
 */
const PUBLIC_READ_PATHS = [
    /^\/checkin\/[^/]+$/,
    /^\/desk-bookings\/checkin\/[^/]+$/
];

/**
 * When REQUIRE_AUTH=true, nothing under /api can be read or changed without a valid login, apart
 * from the public paths above. Mount it after optionalAuth, which attaches req.user.
 * REQUIRE_AUTH is read on every request, so tests can switch it.
 */
function requireLoginForApi(req, res, next) {
    if (process.env.REQUIRE_AUTH !== 'true') return next();
    if (req.method === 'OPTIONS') return next();   // CORS preflight requests never carry credentials
    if (req.user && req.user.authenticated) return next();
    if (req.method === 'GET' && PUBLIC_READ_PATHS.some(re => re.test(req.path))) return next();

    logger.warn(`Refused unauthenticated ${req.method} ${req.originalUrl}`, { reason: req.user && req.user.reason });
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
}

/**
 * Middleware that requires the user to be the owner of a resource
 * Uses a callback to determine ownership
 */
function requireOwnership(getOwnerId) {
    return async (req, res, next) => {
        if (!req.user || !req.user.authenticated) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }
        
        try {
            const ownerId = await getOwnerId(req);
            if (ownerId !== req.user.id && ownerId !== req.user.email) {
                return res.status(403).json({
                    error: 'You do not have permission to modify this resource',
                    code: 'FORBIDDEN'
                });
            }
            next();
        } catch (error) {
            logger.error('Error checking ownership:', error);
            return res.status(500).json({ error: 'Failed to verify ownership' });
        }
    };
}

module.exports = {
    requireAuthForWrites,
    requireLoginForApi,
    PUBLIC_READ_PATHS,
    requireAuth,
    requireOwnership,
    REQUIRE_AUTH_FOR_WRITES
};

