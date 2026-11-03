/**
 * Role checks for routes. See utils/permissions.js for what each role means.
 *
 * attachPermissions runs once per API request (after the login is verified) and sets req.permissions.
 * The guards below then turn that into 401 / 403 answers. They only apply when REQUIRE_AUTH=true.
 */

const { permissionsFor, enforced } = require('../utils/permissions');
const logger = require('../utils/logger');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

async function attachPermissions(req, res, next) {
    try {
        req.permissions = await permissionsFor(req.user);
    } catch (error) {
        // Could not read the role settings: refuse rather than guess
        logger.error('Could not work out permissions:', error.message);
        req.permissions = { enforced: true, isAdmin: false, canBookCalendar: false, canViewAudit: false, jobTitle: null, titleKnown: true, failed: true };
    }
    next();
}

function deny(res, status, code, error) {
    return res.status(status).json({ error, code });
}

// usesTitle: the rule depends on the job title, which may simply not be verified yet
function guard(allowed, message, usesTitle) {
    return (req, res, next) => {
        if (!enforced()) return next();
        if (!req.user || !req.user.authenticated) return deny(res, 401, 'AUTH_REQUIRED', 'Authentication required');
        const permissions = req.permissions || {};
        if (allowed(permissions)) return next();

        // Their job title has not been checked with Microsoft yet: tell the browser to send it and retry
        if (usesTitle && !permissions.titleKnown) {
            return deny(res, 403, 'IDENTITY_UNVERIFIED', 'Your role could not be verified yet. Please try again.');
        }
        logger.warn(`Refused ${req.method} ${req.originalUrl} for ${req.user.email}: ${message}`);
        return deny(res, 403, 'FORBIDDEN', message);
    };
}

const requireAdmin = guard(p => p.isAdmin, 'Only administrators can do this', false);
const requireCalendarAccess = guard(p => p.canBookCalendar, 'Your role is not allowed to make Calendar bookings', true);
const requireAuditAccess = guard(p => p.canViewAudit, 'You do not have access to the audit log', true);

/** Apply a guard to changes only; reads stay open to everyone who is signed in */
function onWrites(guardFn) {
    return (req, res, next) => (READ_METHODS.includes(req.method) ? next() : guardFn(req, res, next));
}

module.exports = { attachPermissions, requireAdmin, requireCalendarAccess, requireAuditAccess, onWrites };
