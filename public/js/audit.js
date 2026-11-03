/**
 * Audit log page: who changed what and when. Visible to admins and the roles chosen on the Access page.
 */

import { escapeHtml, showToast } from './utils.js';

const PAGE_SIZE = 50;
const AREAS = {
    bookings: 'Calendar bookings',
    'desk-bookings': 'Desk bookings',
    desks: 'Desks',
    'floor-elements': 'Floor layout',
    teams: 'Teams',
    locations: 'Locations',
    holidays: 'Holidays',
    settings: 'Settings'
};
const ACTIONS = { create: 'Created', update: 'Changed', delete: 'Deleted', 'check-in': 'Checked in' };
const OUTCOMES = { success: 'Done', denied: 'Not allowed', failed: 'Failed' };

let nextBefore = null;
let loading = false;
let wired = false;

const el = (id) => document.getElementById(id);

function filterQuery() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    const set = (name, id) => { const v = el(id)?.value.trim(); if (v) params.set(name, v); };
    set('actor', 'auditActor');
    set('entity', 'auditEntity');
    set('outcome', 'auditOutcome');
    set('from', 'auditFrom');
    set('to', 'auditTo');
    if (nextBefore !== null) params.set('before', String(nextBefore));
    return params.toString();
}

function whenText(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function detailsHtml(details) {
    if (!details || (typeof details === 'object' && Object.keys(details).length === 0)) return '';
    return `<details class="audit-details"><summary>View</summary><pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre></details>`;
}

function rowHtml(entry) {
    const who = entry.actorName || entry.actorEmail || 'Not signed in';
    const email = entry.actorName && entry.actorEmail ? `<small>${escapeHtml(entry.actorEmail)}</small>` : '';
    const area = AREAS[entry.entity] || entry.entity || '';
    const target = entry.entityId ? ` <small class="audit-id">${escapeHtml(entry.entityId)}</small>` : '';
    const outcome = entry.outcome in OUTCOMES ? entry.outcome : 'failed';
    return `<tr>
        <td class="audit-when">${escapeHtml(whenText(entry.at))}</td>
        <td>${escapeHtml(who)}${email ? '<br>' + email : ''}</td>
        <td>${escapeHtml(ACTIONS[entry.action] || entry.action || '')}</td>
        <td>${escapeHtml(area)}${target}</td>
        <td><span class="audit-badge audit-${outcome}">${OUTCOMES[outcome]}</span></td>
        <td>${detailsHtml(entry.details)}</td>
    </tr>`;
}

async function loadPage(reset) {
    if (loading) return;
    loading = true;
    const body = el('auditRows');
    const more = el('auditMore');
    if (reset) nextBefore = null;
    if (more) more.disabled = true;

    try {
        const response = await fetch(`/api/audit?${filterQuery()}`);
        if (!response.ok) {
            const problem = await response.json().catch(() => ({}));
            throw new Error(problem.error || `HTTP ${response.status}`);
        }
        const { entries, nextBefore: next } = await response.json();
        if (reset) body.innerHTML = '';
        if (reset && entries.length === 0) {
            body.innerHTML = '<tr><td colspan="6" class="empty-state">Nothing recorded for these filters.</td></tr>';
        } else {
            body.insertAdjacentHTML('beforeend', entries.map(rowHtml).join(''));
        }
        nextBefore = next;
        if (more) more.style.display = next === null ? 'none' : '';
    } catch (error) {
        showToast(`Could not load the audit log: ${error.message}`, 'error');
    } finally {
        loading = false;
        if (more) more.disabled = false;
    }
}

export function initAuditView() {
    if (!wired) {
        wired = true;
        const area = el('auditEntity');
        if (area) area.innerHTML = '<option value="">Everything</option>' + Object.entries(AREAS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
        el('auditApply')?.addEventListener('click', () => loadPage(true));
        el('auditMore')?.addEventListener('click', () => loadPage(false));
        el('auditClear')?.addEventListener('click', () => {
            ['auditActor', 'auditEntity', 'auditOutcome', 'auditFrom', 'auditTo'].forEach(id => { if (el(id)) el(id).value = ''; });
            loadPage(true);
        });
    }
    loadPage(true);
}
