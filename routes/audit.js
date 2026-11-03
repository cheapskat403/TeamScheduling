/**
 * Audit log (read only). Visible to admins and to the job titles chosen in "audit_viewer_roles".
 *
 * GET /api/audit?limit=100&before=<id>&actor=<email>&entity=<name>&outcome=<success|denied|failed>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Newest first. Pass the returned nextBefore as `before` to get the next page.
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { requireAuditAccess } = require('../middleware/permissions');
const { checks } = require('../utils/validate');

router.use(requireAuditAccess);

const ENTITY = /^[a-z-]{1,40}$/;
const OUTCOMES = ['success', 'denied', 'failed'];

router.get('/', async (req, res) => {
    try {
        const { actor, entity, outcome, from, to } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
        const before = req.query.before === undefined ? null : parseInt(req.query.before, 10);

        if (before !== null && !Number.isInteger(before)) return res.status(400).json({ error: 'before must be a number' });
        if (entity && !ENTITY.test(entity)) return res.status(400).json({ error: 'Invalid entity' });
        if (outcome && !OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });
        if (actor && String(actor).length > 200) return res.status(400).json({ error: 'Invalid actor' });
        try {
            if (from) checks.date(from, 'from');
            if (to) checks.date(to, 'to');
        } catch (validationError) {
            return res.status(400).json({ error: validationError.message });
        }

        let query = supabase.from('audit_log').select('*');
        if (before !== null) query = query.lt('id', before);
        if (actor) query = query.eq('actor_email', String(actor).toLowerCase());
        if (entity) query = query.eq('entity', entity);
        if (outcome) query = query.eq('outcome', outcome);
        if (from) query = query.gte('at', `${from}T00:00:00+02:00`);   // the office is in South Africa (UTC+2, no daylight saving)
        if (to) query = query.lt('at', `${nextDay(to)}T00:00:00+02:00`);

        const { data, error } = await query.order('id', { ascending: false }).limit(limit);
        if (error) throw error;

        const entries = data.map(row => ({
            id: row.id,
            at: row.at,
            actorEmail: row.actor_email,
            actorName: row.actor_name,
            action: row.action,
            entity: row.entity,
            entityId: row.entity_id,
            outcome: row.outcome,
            status: row.status,
            details: row.details
        }));
        res.json({ entries, nextBefore: entries.length === limit ? entries[entries.length - 1].id : null });
    } catch (error) {
        logger.error('Error reading audit log:', error);
        res.status(500).json({ error: 'Failed to read the audit log' });
    }
});

function nextDay(isoDate) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

module.exports = router;
