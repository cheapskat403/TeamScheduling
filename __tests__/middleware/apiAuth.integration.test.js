/**
 * The login chain exactly as server.js wires it (optionalAuth, then requireLoginForApi), using the real
 * token verification with tokens signed by a test key. Only the fetching of Microsoft's public keys is
 * replaced. Covers valid, expired, forged and wrong-app tokens.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');

const TENANT = 'test-tenant';
const CLIENT = 'test-client';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const keyPair = () => crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const trusted = keyPair();     // the key "Microsoft" publishes
const stranger = keyPair();    // a key an attacker made up
const mockTrustedPublicKey = trusted.publicKey;

jest.mock('jwks-rsa', () => jest.fn(() => ({
    getSigningKey: (kid, cb) => cb(null, { getPublicKey: () => mockTrustedPublicKey })
})));

process.env.AZURE_AD_TENANT_ID = TENANT;
process.env.AZURE_AD_CLIENT_ID = CLIENT;

const { optionalAuth, verifyToken } = require('../../middleware/auth');
const { requireLoginForApi } = require('../../middleware/requireAuth');

const claims = { oid: 'user-1', email: 'jane@example.com', name: 'Jane Doe' };
const sign = (overrides = {}, { key = trusted.privateKey, options = {} } = {}) => {
    const opts = { algorithm: 'RS256', keyid: 'k1', audience: CLIENT, issuer: ISSUER, expiresIn: '1h', ...options };
    Object.keys(opts).forEach(k => opts[k] === undefined && delete opts[k]);   // undefined means "leave this option out"
    return jwt.sign({ ...claims, ...overrides }, key, opts);
};

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', optionalAuth);
    app.use('/api', requireLoginForApi);
    app.get('/api/data', (req, res) => res.json({ seenBy: req.user.email }));
    app.get('/api/desk-bookings', (req, res) => res.json([{ employeeEmail: 'someone@example.com' }]));
    app.post('/api/desk-bookings', (req, res) => res.status(201).json({ created: true }));
    app.get('/api/checkin/:code', (req, res) => res.json({ desk: req.params.code }));
    app.get('/api/desk-bookings/checkin/:code', (req, res) => res.json({ desk: req.params.code }));
    return app;
}

describe('API login chain (REQUIRE_AUTH=true)', () => {
    const app = makeApp();
    beforeEach(() => { process.env.REQUIRE_AUTH = 'true'; });
    afterAll(() => { delete process.env.REQUIRE_AUTH; });

    const bearer = (t) => ({ Authorization: `Bearer ${t}` });

    test('a valid token reads data and is identified', async () => {
        const res = await request(app).get('/api/data').set(bearer(sign())).expect(200);
        expect(res.body.seenBy).toBe('jane@example.com');
    });

    test('a valid token can also write', async () => {
        await request(app).post('/api/desk-bookings').set(bearer(sign())).send({}).expect(201);
    });

    test('no token: reads and writes are refused with AUTH_REQUIRED', async () => {
        for (const call of [
            () => request(app).get('/api/data'),
            () => request(app).get('/api/desk-bookings'),
            () => request(app).post('/api/desk-bookings').send({})
        ]) {
            const res = await call().expect(401);
            expect(res.body.code).toBe('AUTH_REQUIRED');
            expect(JSON.stringify(res.body)).not.toContain('someone@example.com');   // no data leaks in the error
        }
    });

    test.each([
        ['an expired token', () => sign({ exp: Math.floor(Date.now() / 1000) - 60 }, { options: { expiresIn: undefined } })],
        ['a token for a different app (wrong audience)', () => sign({}, { options: { audience: 'some-other-app' } })],
        ['a token from a different tenant (wrong issuer)', () => sign({}, { options: { issuer: 'https://login.microsoftonline.com/other/v2.0' } })],
        ['a token signed with someone else\'s key (forged)', () => sign({}, { key: stranger.privateKey })],
        ['a token with its payload tampered with', () => {
            const [h, , s] = sign().split('.');
            const forged = Buffer.from(JSON.stringify({ ...claims, email: 'admin@example.com', aud: CLIENT, iss: ISSUER, exp: 9999999999 })).toString('base64url');
            return `${h}.${forged}.${s}`;
        }],
        ['an unsigned token (alg none)', () => jwt.sign({ ...claims, aud: CLIENT, iss: ISSUER }, '', { algorithm: 'none' })],
        ['garbage', () => 'not-a-token']
    ])('refuses %s', async (_label, makeToken) => {
        const res = await request(app).get('/api/data').set(bearer(makeToken())).expect(401);
        expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    test('refuses a non-Bearer Authorization header', async () => {
        await request(app).get('/api/data').set('Authorization', 'Basic dXNlcjpwYXNz').expect(401);
    });

    test('QR check-in lookups work with no login, and ignore a bad one', async () => {
        await request(app).get('/api/checkin/abc').expect(200);
        await request(app).get('/api/desk-bookings/checkin/abc').expect(200);
        await request(app).get('/api/checkin/abc').set(bearer('garbage')).expect(200);
    });

    test('the check-in lookups do not open up anything else', async () => {
        await request(app).get('/api/desk-bookings').expect(401);
        await request(app).get('/api/checkin/abc/extra').expect(401);
    });

    test('when REQUIRE_AUTH is off, behaviour is unchanged (no login needed)', async () => {
        process.env.REQUIRE_AUTH = 'false';
        await request(app).get('/api/data').expect(200);
    });
});

describe('API login chain when Azure AD is not configured on the server', () => {
    test('fails closed: a signed token cannot be verified, so everything is refused', async () => {
        let isolatedApp;
        const saved = { t: process.env.AZURE_AD_TENANT_ID, c: process.env.AZURE_AD_CLIENT_ID };
        delete process.env.AZURE_AD_TENANT_ID;
        delete process.env.AZURE_AD_CLIENT_ID;
        jest.isolateModules(() => {
            const { optionalAuth: oa } = require('../../middleware/auth');
            const { requireLoginForApi: rl } = require('../../middleware/requireAuth');
            isolatedApp = express();
            isolatedApp.use('/api', oa, rl);
            isolatedApp.get('/api/data', (req, res) => res.json({ ok: true }));
        });
        process.env.AZURE_AD_TENANT_ID = saved.t;
        process.env.AZURE_AD_CLIENT_ID = saved.c;

        process.env.REQUIRE_AUTH = 'true';
        try {
            await request(isolatedApp).get('/api/data').set({ Authorization: `Bearer ${sign()}` }).expect(401);
        } finally {
            delete process.env.REQUIRE_AUTH;
        }
    });
});

describe('verifyToken (used for websockets)', () => {
    test('resolves with the claims of a valid token', async () => {
        const decoded = await verifyToken(sign());
        expect(decoded).toMatchObject({ oid: 'user-1', email: 'jane@example.com' });
    });

    test.each([
        ['expired', () => sign({ exp: Math.floor(Date.now() / 1000) - 60 }, { options: { expiresIn: undefined } })],
        ['forged', () => sign({}, { key: stranger.privateKey })],
        ['wrong audience', () => sign({}, { options: { audience: 'other' } })],
        ['garbage', () => 'nope']
    ])('rejects a %s token', async (_label, makeToken) => {
        await expect(verifyToken(makeToken())).rejects.toBeTruthy();
    });
});
