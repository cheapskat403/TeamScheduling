/**
 * API rate limits.
 *
 * Everyone in an office usually reaches the server from the same public IP address, so a limit per IP
 * is really a limit for the whole office: one admin editing the desk layout (each change is a save plus
 * a reload of the map, about six requests) could use it up and lock everybody out of every API until
 * the window ran out or the server was restarted.
 *
 * So there are two limits:
 *  - ipLimiter, before login is checked: a generous per-IP ceiling that only stops floods (including
 *    floods of bad tokens, which would otherwise all be verified).
 *  - apiLimiter, after optionalAuth: per signed-in person, or per IP for requests without a valid login.
 *
 * Environment overrides (requests per 15 minutes):
 *  RATE_LIMIT_MAX       per signed-in person   (default 1000)
 *  RATE_LIMIT_ANON_MAX  per IP, not signed in  (default 300)
 *  RATE_LIMIT_IP_MAX    per IP, everything     (default 5000)
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const MESSAGE = { error: 'Too many requests, please wait a few minutes and try again.', code: 'RATE_LIMITED' };

const envInt = (name, fallback) => {
    const value = parseInt(process.env[name], 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const signedInKey = (req) => {
    const user = req.user;
    if (!user || !user.authenticated) return null;
    const id = user.id || (user.email && user.email.toLowerCase());
    return id ? `user:${id}` : null;
};

function createIpLimiter() {
    return rateLimit({
        windowMs: WINDOW_MS,
        limit: () => envInt('RATE_LIMIT_IP_MAX', 5000),
        message: MESSAGE,
        standardHeaders: true,
        legacyHeaders: false,
    });
}

function createApiLimiter() {
    return rateLimit({
        windowMs: WINDOW_MS,
        limit: (req) => (signedInKey(req) ? envInt('RATE_LIMIT_MAX', 1000) : envInt('RATE_LIMIT_ANON_MAX', 300)),
        keyGenerator: (req) => signedInKey(req) || `ip:${ipKeyGenerator(req.ip)}`,
        message: MESSAGE,
        standardHeaders: true,
        legacyHeaders: false,
    });
}

module.exports = { createIpLimiter, createApiLimiter };
