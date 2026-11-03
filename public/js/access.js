/**
 * Access & Roles page (admins only).
 *  - Admins: who they are (emails).
 *  - Job title permissions: for each Azure AD job title, can they lead teams and make Calendar bookings
 *    (the "team_roles" setting), and can they read the audit log ("audit_viewer_roles")?
 */

import { escapeHtml, showToast } from './utils.js';
import { apiGet, apiPut } from './fetch-utils.js';
import { cacheAllowedTeamRoles } from './azure-managers.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAD = 'team_roles';
const AUDIT = 'audit_viewer_roles';

let admins = [];
const roles = { [LEAD]: [], [AUDIT]: [] };   // job titles chosen for each permission
let azureTitles = [];
let order = [];                              // titles in display order (selected first, then A-Z), kept stable while toggling
let wired = false;
const saveQueue = { [LEAD]: Promise.resolve(), [AUDIT]: Promise.resolve(), admin_emails: Promise.resolve() };

const el = (id) => document.getElementById(id);
const norm = (title) => String(title).trim().replace(/\s+/g, ' ').toLowerCase();
const has = (key, title) => roles[key].some(t => norm(t) === norm(title));

/** Saves one setting; saves of the same setting run one after another so the last click wins */
function save(key, list) {
    const run = () => apiPut(`/api/settings/${key}`, { value: list });
    saveQueue[key] = saveQueue[key].then(run, run);
    return saveQueue[key];
}

// ------------------------------------------------------------------ admins

function renderAdmins() {
    const box = el('adminList');
    if (!box) return;
    box.innerHTML = admins.length
        ? admins.map((email, i) => `<div class="admin-chip"><span>${escapeHtml(email)}</span>
            <button type="button" data-remove-admin="${i}" title="Remove" aria-label="Remove ${escapeHtml(email)}">&times;</button></div>`).join('')
        : '<p class="empty-state">No admins saved here yet.</p>';
}

async function addAdmin() {
    const input = el('adminEmail');
    const email = input.value.trim().toLowerCase();
    if (!EMAIL.test(email)) return showToast('Enter a valid email address', 'error');
    if (admins.includes(email)) return showToast('Already an admin', 'error');
    try {
        const next = [...admins, email];
        await save('admin_emails', next);
        admins = next;
        input.value = '';
        renderAdmins();
        showToast('Admin added');
    } catch (error) {
        showToast(`Could not save: ${error.message}`, 'error');
    }
}

async function removeAdmin(index) {
    const next = admins.filter((_, i) => i !== index);
    try {
        await save('admin_emails', next);
        admins = next;
        renderAdmins();
    } catch (error) {
        showToast(`Could not save: ${error.message}`, 'error');
    }
}

// ------------------------------------------------------------------ job title permissions

function allTitles() {
    const seen = new Map();
    [...azureTitles, ...roles[LEAD], ...roles[AUDIT]].forEach(t => { if (!seen.has(norm(t))) seen.set(norm(t), t); });
    return [...seen.values()];
}

function sortTitles() {
    order = allTitles().sort((a, b) => {
        const sa = has(LEAD, a) || has(AUDIT, a) ? 0 : 1;
        const sb = has(LEAD, b) || has(AUDIT, b) ? 0 : 1;
        return sa - sb || a.localeCompare(b);
    });
}

function renderRows() {
    const body = el('permRows');
    if (!body) return;
    const query = norm(el('permSearch')?.value || '');
    const onlySelected = !!el('permOnlySelected')?.checked;

    const shown = order.filter(t => (!query || norm(t).includes(query)) && (!onlySelected || has(LEAD, t) || has(AUDIT, t)));
    body.innerHTML = shown.length
        ? shown.map(t => `<tr>
            <td>${escapeHtml(t)}</td>
            <td class="perm-col">${switchHtml(LEAD, t, 'Lead teams and Calendar bookings')}</td>
            <td class="perm-col">${switchHtml(AUDIT, t, 'Read the audit log')}</td>
        </tr>`).join('')
        : `<tr><td colspan="3" class="empty-state">${order.length ? 'No job titles match.' : 'No job titles to show. Sign in with Azure AD and press Refresh.'}</td></tr>`;

    renderSummary();
}

function switchHtml(key, title, label) {
    return `<label class="switch"><input type="checkbox" data-key="${key}" data-title="${escapeHtml(title)}" ${has(key, title) ? 'checked' : ''} aria-label="${escapeHtml(label)}: ${escapeHtml(title)}"><span class="switch-track"></span></label>`;
}

async function togglePermission(input) {
    const { key, title } = input.dataset;
    const wanted = input.checked;
    const previous = roles[key];
    const next = wanted ? [...previous, title] : previous.filter(t => norm(t) !== norm(title));

    roles[key] = next;
    input.disabled = true;
    try {
        await save(key, next);
        if (key === LEAD) cacheAllowedTeamRoles(next);
        renderSummary();
    } catch (error) {
        roles[key] = previous;
        input.checked = !wanted;
        showToast(`Could not save: ${error.message}`, 'error');
    } finally {
        input.disabled = false;
    }
}

function renderSummary() {
    el('permSummary').textContent =
        `${roles[LEAD].length} job title${roles[LEAD].length === 1 ? '' : 's'} can lead teams and make Calendar bookings; ` +
        `${roles[AUDIT].length} can read the audit log.`;
}

async function loadAzureTitles() {
    if (typeof window.fetchAllJobTitles !== 'function') return [];
    try { return await window.fetchAllJobTitles(); } catch (error) { return []; }
}

async function refreshTitles() {
    const button = el('permRefresh');
    if (button) button.disabled = true;
    azureTitles = await loadAzureTitles();
    sortTitles();
    renderRows();
    if (button) button.disabled = false;
}

// ------------------------------------------------------------------ page

export async function initAccessView() {
    if (!wired) {
        wired = true;
        el('adminAdd')?.addEventListener('click', addAdmin);
        el('adminEmail')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAdmin(); } });
        el('adminList')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove-admin]');
            if (btn) removeAdmin(Number(btn.dataset.removeAdmin));
        });
        el('permSearch')?.addEventListener('input', renderRows);
        el('permOnlySelected')?.addEventListener('change', renderRows);
        el('permRefresh')?.addEventListener('click', refreshTitles);
        el('permRows')?.addEventListener('change', (e) => {
            if (e.target.matches('input[data-key]')) togglePermission(e.target);
        });
    }

    try {
        const [adminSetting, leadSetting, auditSetting] = await Promise.all([
            apiGet('/api/settings/admin_emails'), apiGet(`/api/settings/${LEAD}`), apiGet(`/api/settings/${AUDIT}`)
        ]);
        admins = adminSetting.value || [];
        roles[LEAD] = Array.isArray(leadSetting.value) ? leadSetting.value : [];
        roles[AUDIT] = Array.isArray(auditSetting.value) ? auditSetting.value : [];
        cacheAllowedTeamRoles(roles[LEAD]);
    } catch (error) {
        showToast(`Could not load access settings: ${error.message}`, 'error');
    }

    renderAdmins();
    sortTitles();
    renderRows();            // show what is already chosen straight away
    azureTitles = await loadAzureTitles();
    sortTitles();
    renderRows();
}
