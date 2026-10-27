/**
 * Tests for authentication middleware
 */
// jwks-rsa v4 depends on ESM-only `jose`, which Jest can't parse; JWKS isn't exercised here
jest.mock('jwks-rsa', () => jest.fn());

const { extractToken } = require('../../middleware/auth');
const { requireAuthForWrites, requireAuth } = require('../../middleware/requireAuth');

describe('extractToken', () => {
    test('extracts token from valid Bearer header', () => {
        const req = {
            headers: {
                authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test'
            }
        };
        const token = extractToken(req);
        expect(token).toBe('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test');
    });

    test('returns null for missing Authorization header', () => {
        const req = { headers: {} };
        const token = extractToken(req);
        expect(token).toBeNull();
    });

    test('returns null for non-Bearer auth', () => {
        const req = {
            headers: {
                authorization: 'Basic dXNlcjpwYXNz'
            }
        };
        const token = extractToken(req);
        expect(token).toBeNull();
    });

    test('returns null for malformed header', () => {
        const req = {
            headers: {
                authorization: 'Bearer'
            }
        };
        const token = extractToken(req);
        expect(token).toBeNull();
    });

    test('handles case-insensitive Bearer prefix', () => {
        const req = {
            headers: {
                authorization: 'bearer sometoken'
            }
        };
        const token = extractToken(req);
        expect(token).toBe('sometoken');
    });
});

describe('requireAuthForWrites', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            method: 'GET',
            originalUrl: '/api/test',
            user: null
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    test('allows GET requests without authentication', () => {
        req.method = 'GET';
        requireAuthForWrites(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('allows HEAD requests without authentication', () => {
        req.method = 'HEAD';
        requireAuthForWrites(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('allows OPTIONS requests without authentication', () => {
        req.method = 'OPTIONS';
        requireAuthForWrites(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('allows POST when REQUIRE_AUTH is false (default)', () => {
        // Default is REQUIRE_AUTH=false, so POST should be allowed
        req.method = 'POST';
        requireAuthForWrites(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('allows PUT when REQUIRE_AUTH is false (default)', () => {
        req.method = 'PUT';
        requireAuthForWrites(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('allows DELETE when REQUIRE_AUTH is false (default)', () => {
        req.method = 'DELETE';
        requireAuthForWrites(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});

describe('requireAuth', () => {
    let req, res, next;

    beforeEach(() => {
        req = { user: null };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    test('returns 401 when user is not authenticated', () => {
        requireAuth(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when user.authenticated is false', () => {
        req.user = { authenticated: false };
        requireAuth(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('calls next when user is authenticated', () => {
        req.user = { authenticated: true, id: 'user123', email: 'test@example.com' };
        requireAuth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});

