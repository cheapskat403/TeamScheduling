/**
 * requireLoginForApi: with REQUIRE_AUTH=true nothing under /api works without a login,
 * except the QR check-in lookups.
 */
const { requireLoginForApi } = require('../../middleware/requireAuth');

describe('requireLoginForApi', () => {
    const original = process.env.REQUIRE_AUTH;
    beforeEach(() => { process.env.REQUIRE_AUTH = 'true'; });
    afterAll(() => {
        if (original === undefined) delete process.env.REQUIRE_AUTH;
        else process.env.REQUIRE_AUTH = original;
    });

    const run = (req) => {
        const res = createMockResponse();
        const next = jest.fn();
        requireLoginForApi({ method: 'GET', path: '/data', originalUrl: '/api/data', ...req }, res, next);
        return { res, next };
    };
    const signedIn = { authenticated: true, email: 'jane@example.com' };

    test('does nothing when REQUIRE_AUTH is not true', () => {
        process.env.REQUIRE_AUTH = 'false';
        const { next, res } = run({ user: { authenticated: false } });
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();

        delete process.env.REQUIRE_AUTH;
        expect(run({}).next).toHaveBeenCalled();
    });

    test('lets a signed-in user through', () => {
        expect(run({ user: signedIn }).next).toHaveBeenCalled();
    });

    test.each([
        ['no user attached at all', undefined],
        ['no token sent', { authenticated: false, reason: 'no_token' }],
        ['token that failed verification', { authenticated: false, reason: 'invalid_token' }],
        ['Azure AD not configured on the server (fail closed)', { authenticated: false, reason: 'auth_not_configured' }]
    ])('refuses reads with %s', (_label, user) => {
        const { res, next } = run({ user });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    });

    test.each(['/data', '/desk-bookings', '/bookings', '/desks', '/teams', '/settings/team_roles', '/holidays', '/locations'])(
        'refuses an unauthenticated read of %s', (path) => {
            const { res, next } = run({ path, user: { authenticated: false } });
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
        });

    test('refuses unauthenticated writes as well', () => {
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
            const { res, next } = run({ method, path: '/desk-bookings', user: { authenticated: false } });
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
        }
    });

    test('lets CORS preflight requests through (they never carry credentials)', () => {
        expect(run({ method: 'OPTIONS', path: '/desk-bookings', user: { authenticated: false } }).next).toHaveBeenCalled();
    });

    describe('QR check-in lookups stay public', () => {
        test.each(['/checkin/abc123', '/desk-bookings/checkin/abc123', '/checkin/jhb-a01-4e121e93'])(
            'GET %s works without a login', (path) => {
                const { next, res } = run({ path, user: { authenticated: false } });
                expect(next).toHaveBeenCalled();
                expect(res.status).not.toHaveBeenCalled();
            });

        test.each([
            ['POST', '/checkin/abc123'],
            ['POST', '/desk-bookings/checkin/abc123'],
            ['DELETE', '/checkin/abc123'],
            ['POST', '/desk-bookings/123/checkin']       // the actual check-in action: still needs a login
        ])('%s %s is not public', (method, path) => {
            const { res, next } = run({ method, path, user: { authenticated: false } });
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
        });

        test.each([
            '/checkin',                          // no code
            '/checkin/',
            '/checkin/abc/extra',                // extra segment
            '/checkin/../data',                  // trying to reach another route
            '/desk-bookings/checkin',
            '/desk-bookings/checkin/abc/more',
            '/desk-bookings',
            '/data/checkin/abc',
            '/checkins/abc'
        ])('lookalike path %s is NOT public', (path) => {
            const { res, next } = run({ path, user: { authenticated: false } });
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
        });
    });
});
