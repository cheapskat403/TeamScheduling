/**
 * Audit log: one row for every change made through the API (create, update, delete, check-in), and for
 * every change that was refused. It records who, what, when and the outcome. It never blocks or fails the
 * request: the row is written after the response has gone out, and a failure to write is only logged.
 *
 * What is kept of the request body is cut down first (see sanitize): photos, QR codes and similar are not
 * stored, long text is shortened and the whole thing is size-capped.
 */

const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const HIDDEN_KEY = /image|photo|password|token|secret|qr/i;
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 3;
const MAX_JSON = 4000;

function sanitize(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        if (/^data:/i.test(value)) return '[file]';
        return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    }
    if (typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return '[nested]';
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ITEMS).map(v => sanitize(v, depth + 1));
        if (value.length > MAX_ITEMS) items.push(`… ${value.length - MAX_ITEMS} more`);
        return items;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, HIDDEN_KEY.test(k) ? '[hidden]' : sanitize(v, depth + 1)]));
}

function cappedDetails(body) {
    const details = sanitize(body);
    if (details === undefined || details === null) return null;
    return JSON.stringify(details).length > MAX_JSON ? { note: 'Request was too large to store' } : details;
}

/** "/api/desk-bookings/abc/checkin?x=1" -> { entity: 'desk-bookings', entityId: 'abc', sub: 'checkin' } */
function describePath(originalUrl) {
    const [, , entity, entityId, sub] = originalUrl.split('?')[0].split('/').map(part => {
        try { return decodeURIComponent(part); } catch (error) { return part; }
    });
    return { entity: entity || null, entityId: entityId || null, sub: sub || null };
}

function actionFor(method, sub) {
    if (sub === 'checkin') return 'check-in';
    return { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] || method.toLowerCase();
}

function auditWrites(req, res, next) {
    if (READ_METHODS.includes(req.method)) return next();

    // Remember the id of whatever was created, from the response body
    let responseId = null;
    const json = res.json.bind(res);
    res.json = (body) => {
        if (body && typeof body === 'object') responseId = body.id || (body.booking && body.booking.id) || null;
        return json(body);
    };

    res.on('finish', () => {
        if (res.statusCode === 401) return;   // not signed in: nobody to attribute it to

        const { entity, entityId, sub } = describePath(req.originalUrl);
        const user = req.user && req.user.authenticated ? req.user : null;
        const outcome = res.statusCode < 400 ? 'success' : res.statusCode === 403 ? 'denied' : 'failed';

        const row = {
            actor_email: user ? String(user.email || '').toLowerCase() : null,
            actor_name: user ? user.name || null : null,
            actor_id: user ? user.id || null : null,
            action: actionFor(req.method, sub),
            entity,
            entity_id: entityId || (outcome === 'success' ? responseId : null),
            outcome,
            status: res.statusCode,
            details: cappedDetails(req.body)
        };

        Promise.resolve(supabase.from('audit_log').insert(row)).then(
            ({ error }) => { if (error) logger.error('Could not write audit log:', error.message); },
            (error) => logger.error('Could not write audit log:', error.message)
        );
    });

    next();
}

module.exports = { auditWrites, sanitize, describePath, actionFor };
