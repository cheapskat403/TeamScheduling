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

const fieldName = (key) => key.replace(/_/g, ' ');
const valueText = (value) => {
    if (value === null || value === undefined || value === '') return '(empty)';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

function detailsHtml(details) {
    if (!details || (typeof details === 'object' && Object.keys(details).length === 0)) return '';

    let body;
    if (details.deleted || details.created) {
        // What a delete removed, or what a create made
        const fields = details.deleted || details.created;
        body = `<p class="audit-note${details.created ? ' audit-note-new' : ''}">${details.created ? 'New record' : 'Deleted record'}</p><dl class="audit-fields">` + Object.entries(fields)
            .map(([k, v]) => `<dt>${escapeHtml(fieldName(k))}</dt><dd>${escapeHtml(valueText(v))}</dd>`).join('') + '</dl>';
    } else if (details.changed) {
        // What an update changed: old value, then new value
        body = '<dl class="audit-fields">' + Object.entries(details.changed)
            .map(([k, c]) => `<dt>${escapeHtml(fieldName(k))}</dt><dd><span class="audit-old">${escapeHtml(valueText(c.from))}</span> &rarr; <span class="audit-new">${escapeHtml(valueText(c.to))}</span></dd>`).join('') + '</dl>';
    } else {
        const { label, ...rest } = details;
        if (Object.keys(rest).length === 0) return '';
        body = `<pre>${escapeHtml(JSON.stringify(rest.request || rest, null, 2))}</pre>`;
    }
    return `<details class="audit-details"><summary>View</summary>${body}</details>`;
}

function rowHtml(entry) {
    const who = entry.actorName || entry.actorEmail || 'Not signed in';
    const email = entry.actorName && entry.actorEmail ? `<small>${escapeHtml(entry.actorEmail)}</small>` : '';
    const area = AREAS[entry.entity] || entry.entity || '';
    const label = entry.details && typeof entry.details.label === 'string' ? entry.details.label : '';
    const target = label
        ? `<br><span class="audit-label">${escapeHtml(label)}</span>`
        : entry.entityId ? ` <small class="audit-id">${escapeHtml(entry.entityId)}</small>` : '';
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
    return loadPage(true);
}
