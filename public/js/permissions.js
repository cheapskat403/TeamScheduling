/**
 * What the signed-in user may do, as reported by the server (/api/me).
 *
 * This only decides what to show. The server checks every change itself, so hiding a button here is
 * convenience, not security. The result is also written onto <body> as classes (is-admin, can-calendar,
 * can-audit) so the page can hide controls with CSS.
 */

const REFRESH_MS = 10 * 60 * 1000;   // the server remembers job titles for 30 minutes

let current = { isAdmin: true, canBookCalendar: true, canViewAudit: true, enforced: false, loaded: false };
let timer = null;
let inFlight = null;

function apply(permissions) {
    const before = JSON.stringify([current.isAdmin, current.canBookCalendar, current.canViewAudit]);
    current = { ...permissions, loaded: true };
    window.appPermissions = current;
    document.body.classList.toggle('is-admin', !!current.isAdmin);
    document.body.classList.toggle('can-calendar', !!current.canBookCalendar);
    document.body.classList.toggle('can-audit', !!current.canViewAudit);
    if (before !== JSON.stringify([current.isAdmin, current.canBookCalendar, current.canViewAudit])) {
        document.dispatchEvent(new CustomEvent('permissions-changed', { detail: current }));
    }
}

async function fetchMe() {
    // The Graph token lets the server verify our job title with Microsoft. It is sent to /api/me only.
    const headers = {};
    if (typeof window.getGraphTokenQuietly === 'function') {
        const graphToken = await window.getGraphTokenQuietly();
        if (graphToken) headers['X-Graph-Token'] = graphToken;
    }
    const response = await fetch('/api/me', { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/** Ask the server who we are and what we may do. Safe to call often: calls made together share one request. */
export function loadPermissions() {
    if (!inFlight) {
        inFlight = fetchMe()
            .then(apply)
            .catch(error => {
                // Cannot tell: show only what everybody can do. The server would refuse the rest anyway.
                console.warn('Could not load permissions:', error.message);
                apply({ isAdmin: false, canBookCalendar: false, canViewAudit: false, enforced: true });
            })
            .finally(() => { inFlight = null; });
    }
    if (!timer) timer = setInterval(loadPermissions, REFRESH_MS);
    return inFlight;
}

export const getPermissions = () => current;
export const isAdmin = () => !!current.isAdmin;
export const canBookCalendar = () => !!current.canBookCalendar;
export const canViewAudit = () => !!current.canViewAudit;

/** Views only some people may open (the server also refuses their data) */
export const ADMIN_VIEWS = ['locations', 'holidays', 'access'];
export function canOpenView(viewName) {
    if (ADMIN_VIEWS.includes(viewName)) return isAdmin();
    if (viewName === 'teams') return isAdmin() || canBookCalendar();   // team leads add and edit teams
    if (viewName === 'audit') return canViewAudit();
    return true;
}

// Lets auth.js (a plain script) ask for a refresh when the server says our role is not verified yet
window.refreshPermissions = loadPermissions;
