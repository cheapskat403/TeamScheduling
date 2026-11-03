/**
 * Who may do what.
 *
 *   admin         can change anything (teams, locations, holidays, desk layout, settings, any booking) and
 *                 can read the audit log. Admins are the emails in the ADMIN_EMAILS environment variable
 *                 plus the "admin_emails" setting that admins manage in the app.
 *   calendar      can make, change and delete Calendar (team) bookings: admins, and anyone whose Azure AD
 *                 job title is in the "team_roles" setting.
 *   audit viewer  can read the audit log: admins, and anyone whose job title is in "audit_viewer_roles".
 *   everyone      signed in can make desk bookings and cancel their own.
 *
 * Nothing is enforced unless REQUIRE_AUTH=true, because without logins there is nobody to check. In that
 * mode everybody is treated as an admin, which is how local development and the existing tests behave.
 */

const { supabase } = require('../config/supabase');
const logger = require('./logger');
const graphIdentity = require('./graphIdentity');

const SETTING_KEYS = ['team_roles', 'admin_emails', 'audit_viewer_roles'];
const CONFIG_TTL_MS = 30 * 1000;
let configCache = null;

const enforced = () => process.env.REQUIRE_AUTH === 'true';
const normalizeTitle = (title) => String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function envAdmins() {
    return (process.env.ADMIN_EMAILS || '').split(/[,;\s]+/).map(normalizeEmail).filter(Boolean);
}

/** The three settings that drive permissions, cached briefly so every request does not hit the database */
async function loadConfig() {
    if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;

    const { data, error } = await supabase.from('settings').select('key, value').in('key', SETTING_KEYS);
    if (error) throw error;

    const byKey = Object.fromEntries((data || []).map(row => [row.key, row.value]));
    const list = (key) => (Array.isArray(byKey[key]) ? byKey[key] : []);
    const value = {
        teamRoles: new Set(list('team_roles').map(normalizeTitle)),
        auditRoles: new Set(list('audit_viewer_roles').map(normalizeTitle)),
        adminEmails: new Set([...envAdmins(), ...list('admin_emails').map(normalizeEmail)])
    };
    configCache = { at: Date.now(), value };
    return value;
}

/** Call after a permission setting changes so the change applies straight away */
function invalidateConfig() { configCache = null; }

/**
 * What this signed-in user may do. `titleKnown` is false when their job title has not been verified with
 * Graph yet (the browser then forwards its Graph token and tries again).
 */
async function permissionsFor(user) {
    if (!enforced()) {
        return { enforced: false, isAdmin: true, canBookCalendar: true, canViewAudit: true, jobTitle: null, titleKnown: true };
    }
    if (!user || !user.authenticated) {
        return { enforced: true, isAdmin: false, canBookCalendar: false, canViewAudit: false, jobTitle: null, titleKnown: true };
    }

    const config = await loadConfig();
    const isAdmin = config.adminEmails.has(normalizeEmail(user.email));

    const known = graphIdentity.cached(user.id);
    const jobTitle = known ? known.jobTitle : null;
    const title = normalizeTitle(jobTitle);

    return {
        enforced: true,
        isAdmin,
        canBookCalendar: isAdmin || (!!title && config.teamRoles.has(title)),
        canViewAudit: isAdmin || (!!title && config.auditRoles.has(title)),
        jobTitle,
        titleKnown: !!known
    };
}

function warnIfNoAdmins() {
    if (enforced() && envAdmins().length === 0) {
        logger.warn('REQUIRE_AUTH=true but ADMIN_EMAILS is empty: only admins saved in the app can change settings. Set ADMIN_EMAILS to avoid being locked out.');
    }
}

module.exports = { permissionsFor, loadConfig, invalidateConfig, enforced, normalizeTitle, normalizeEmail, envAdmins, warnIfNoAdmins, SETTING_KEYS };
