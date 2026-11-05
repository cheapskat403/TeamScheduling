/**
 * Rate limits are per signed-in person, so one busy user (an admin editing the desk layout) cannot lock
 * out everyone else coming from the same office IP.
 */
const request = require('supertest');
const express = require('express');
const { createIpLimiter, createApiLimiter } = require('../../middleware/rateLimit');

const ENV_KEYS = ['RATE_LIMIT_MAX', 'RATE_LIMIT_ANON_MAX', 'RATE_LIMIT_IP_MAX'];
const saved = {};
beforeEach(() => ENV_KEYS.forEach(k => { saved[k] = process.env[k]; }));
afterEach(() => ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

// Stand-in for optionalAuth: the test says who is signed in with an x-test-user header
function buildApp() {
    const app = express();
    app.use('/api', createIpLimiter());
    app.use('/api', (req, res, next) => {
        const id = req.get('x-test-user');
        req.user = id ? { authenticated: true, id, email: `${id}@example.com` } : { authenticated: false, reason: 'no_token' };
        next();
    });
    app.use('/api', createApiLimiter());
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
    return app;
}

const hit = (app, user) => {
    const r = request(app).get('/api/ping');
    return user ? r.set('x-test-user', user) : r;
};

describe('API rate limits', () => {
    test('one person using up their limit does not block others on the same IP', async () => {
        process.env.RATE_LIMIT_MAX = '3';
        const app = buildApp();

        for (let i = 0; i < 3; i++) expect((await hit(app, 'admin')).status).toBe(200);
        const blocked = await hit(app, 'admin');
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('RATE_LIMITED');

        expect((await hit(app, 'colleague')).status).toBe(200);
        expect((await hit(app)).status).toBe(200);
    });

    test('requests without a login share a per-IP limit', async () => {
        process.env.RATE_LIMIT_ANON_MAX = '2';
        const app = buildApp();

        expect((await hit(app)).status).toBe(200);
        expect((await hit(app)).status).toBe(200);
        expect((await hit(app)).status).toBe(429);
        expect((await hit(app, 'someone')).status).toBe(200);
    });

    test('the per-IP flood guard covers everyone', async () => {
        process.env.RATE_LIMIT_IP_MAX = '4';
        const app = buildApp();

        for (const user of ['a', 'b', 'c', 'd']) expect((await hit(app, user)).status).toBe(200);
        expect((await hit(app, 'e')).status).toBe(429);
    });

    test('defaults allow far more than the old 200 per IP', async () => {
        const app = buildApp();
        const res = await hit(app, 'admin');
        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-policy']).toMatch(/^1000;/);
    });
});
