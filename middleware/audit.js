/**
 * Audit log: one row for every change made through the API (create, update, delete, check-in), and for
 * every change that was refused. It records who, what, when and the outcome. It never blocks or fails the
 * request: the row is written after the response has gone out, and a failure to write is only logged.
 *
 * For updates, deletes and check-ins the record is looked up just before the change, so the log can say
 * what it was ("Absa CIB on 2026-11-05"), what a delete removed, and what an update changed (old -> new).
 * Only a short list of fields per record is kept, photos, QR codes and similar are never stored, long text
 * is shortened and every entry is size-capped.
 */

const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { toSnakeCase } = require('../utils/helpers');
const { enforced } = require('../utils/permissions');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const HIDDEN_KEY = /image|photo|password|token|secret|qr/i;
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 3;
const MAX_JSON = 4000;

/**
 * How to find and describe the record behind each API area: its table, the column the URL id refers to,
 * the fields worth keeping, and a short human label.
 */
const SOURCES = {
    bookings: {
        table: 'bookings', key: 'id',
        fields: ['date', 'team_name', 'people_count', 'location_id', 'notes'],
        label: r => `${r.team_name} on ${r.date}`
    },
    'desk-bookings': {
        table: 'desk_bookings', key: 'id',
        fields: ['date', 'desk_name', 'employee_name', 'employee_email', 'location_id', 'checked_in'],
        label: r => `${r.desk_name} on ${r.date}${r.employee_name ? ` (${r.employee_name})` : ''}`
    },
    desks: {
        table: 'desks', key: 'id',
        fields: ['name', 'floor', 'zone', 'desk_type', 'assigned_team_id'],
        label: r => r.name
    },
    teams: {
        table: 'teams', key: 'id',
        fields: ['name', 'manager', 'member_count', 'location_id', 'color'],
        label: r => r.name
    },
    locations: {
        table: 'locations', key: 'id',
        fields: ['name', 'address', 'capacity', 'floors'],
        label: r => r.name
    },
    'floor-elements': {
        table: 'floor_elements', key: 'id',
        fields: ['type', 'label', 'floor', 'color'],
        label: r => `${r.type}${r.label ? `: ${r.label}` : ''}`
    },
    holidays: {
        table: 'public_holidays', key: 'date',
        fields: ['date', 'name'],
        label: r => `${r.name} (${r.date})`
    },
    settings: {
        table: 'settings', key: 'key',
        fields: ['value'],
        label: r => r.key
    }
};

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

function capped(details) {
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

/** The record as it is right now, or null when it cannot be found (or looked up) */
async function loadBefore(entity, entityId) {
    const source = SOURCES[entity];
    if (!source || !entityId) return null;
    try {
        const { data, error } = await supabase.from(source.table).select('*').eq(source.key, entityId).maybeSingle();
        return error ? null : data || null;
    } catch (error) {
        return null;
    }
}

function pick(row, fields) {
    return Object.fromEntries(fields.filter(f => f in row).map(f => [f, row[f]]));
}

/** What an update changed: { field: { from, to } } for the fields in the request whose value differs */
function changesBetween(before, body) {
    const changed = {};
    Object.entries(toSnakeCase(body && typeof body === 'object' ? body : {})).forEach(([key, value]) => {
        if (!(key in before) || HIDDEN_KEY.test(key)) return;
        if (JSON.stringify(before[key]) !== JSON.stringify(value)) changed[key] = { from: sanitize(before[key]), to: sanitize(value) };
    });
    return changed;
}

function detailsFor({ entity, action, before, after, body }) {
    const source = SOURCES[entity];
    if (action === 'create' && after && source) {
        return capped({ label: sanitize(source.label(after)), created: sanitize(pick(after, source.fields)) });
    }
    if (!before || !source) return capped(sanitize(body));

    const label = sanitize(source.label(before));
    if (action === 'delete') return capped({ label, deleted: sanitize(pick(before, source.fields)) });
    if (action === 'update') {
        const changed = changesBetween(before, body);
        return capped(Object.keys(changed).length ? { label, changed } : { label, request: sanitize(body) });
    }
    return capped({ label });
}

async function auditWrites(req, res, next) {
    if (READ_METHODS.includes(req.method)) return next();

    const { entity, entityId, sub } = describePath(req.originalUrl);
    const action = actionFor(req.method, sub);

    // Look the record up before the route changes or removes it. Only for people who are allowed to try:
    // an unauthenticated request is answered with 401 and not logged at all.
    const mayProceed = !enforced() || (req.user && req.user.authenticated);
    const before = mayProceed && action !== 'create' ? await loadBefore(entity, entityId) : null;

    // Remember the id of whatever was created, from the response body
    let responseId = null;
    const json = res.json.bind(res);
    res.json = (body) => {
        if (body && typeof body === 'object') responseId = body.id || (body.booking && body.booking.id) || null;
        return json(body);
    };

    res.on('finish', async () => {
        if (res.statusCode === 401) return;

        const user = req.user && req.user.authenticated ? req.user : null;
        const outcome = res.statusCode < 400 ? 'success' : res.statusCode === 403 ? 'denied' : 'failed';

        // A new record: read it back so the log can name it (its id is only known from the response)
        const after = action === 'create' && outcome === 'success' && !entityId && responseId ? await loadBefore(entity, responseId) : null;

        const row = {
            actor_email: user ? String(user.email || '').toLowerCase() : null,
            actor_name: user ? user.name || null : null,
            actor_id: user ? user.id || null : null,
            action,
            entity,
            entity_id: entityId || (outcome === 'success' ? responseId : null),
            outcome,
            status: res.statusCode,
            details: detailsFor({ entity, action, before, after, body: req.body })
        };

        Promise.resolve(supabase.from('audit_log').insert(row)).then(
            ({ error }) => { if (error) logger.error('Could not write audit log:', error.message); },
            (error) => logger.error('Could not write audit log:', error.message)
        );
    });

    next();
}

module.exports = { auditWrites, sanitize, describePath, actionFor, changesBetween, detailsFor, SOURCES };
