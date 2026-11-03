/**
 * Access page (admins only): who the admins are, and which job titles may read the audit log.
 * Calendar bookings use the Team Roles list, which has its own page.
 */

import { escapeHtml, showToast } from './utils.js';
import { apiGet, apiPut } from './fetch-utils.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let admins = [];
let auditRoles = [];
let wired = false;

const el = (id) => document.getElementById(id);

async function save(key, list) {
    await apiPut(`/api/settings/${key}`, { value: list });
}

function chips(containerId, items, removeAttr, emptyText) {
    const box = el(containerId);
    if (!box) return;
    box.innerHTML = items.length
        ? items.map((item, i) => `<div class="allowed-role-item"><span>${escapeHtml(item)}</span>
            <button type="button" class="btn-icon danger" ${removeAttr}="${i}" title="Remove" aria-label="Remove ${escapeHtml(item)}">&times;</button></div>`).join('')
        : `<p class="empty-state">${emptyText}</p>`;
}

function render() {
    chips('adminList', admins, 'data-remove-admin', 'No admins saved here. Admins set on the server (ADMIN_EMAILS) are not listed.');
    chips('auditRoleList', auditRoles, 'data-remove-audit-role', 'No job titles selected. Only admins can read the audit log.');
}

async function loadTeamRoles() {
    const box = el('calendarRoleList');
    if (!box) return;
    try {
        const { value } = await apiGet('/api/settings/team_roles');
        const roles = Array.isArray(value) ? value : [];
        box.innerHTML = roles.length
            ? roles.map(r => `<div class="allowed-role-item"><span>${escapeHtml(r)}</span></div>`).join('')
            : '<p class="empty-state">No job titles selected, so only admins can make Calendar bookings.</p>';
    } catch (error) {
        box.innerHTML = '<p class="empty-state">Could not load this list.</p>';
    }
}

async function loadJobTitleChoices() {
    const list = el('auditRoleChoices');
    if (!list || typeof window.fetchAllJobTitles !== 'function') return;
    try {
        const titles = await window.fetchAllJobTitles();
        list.innerHTML = titles.map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
    } catch (error) { /* typing a title still works */ }
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
        render();
        showToast('Admin added');
    } catch (error) {
        showToast(`Could not save: ${error.message}`, 'error');
    }
}

async function addAuditRole() {
    const input = el('auditRoleInput');
    const title = input.value.trim();
    if (!title) return;
    if (auditRoles.some(r => r.toLowerCase() === title.toLowerCase())) return showToast('Already added', 'error');
    try {
        const next = [...auditRoles, title];
        await save('audit_viewer_roles', next);
        auditRoles = next;
        input.value = '';
        render();
        showToast('Job title added');
    } catch (error) {
        showToast(`Could not save: ${error.message}`, 'error');
    }
}

async function removeFrom(key, list, index) {
    const next = list.filter((_, i) => i !== index);
    try {
        await save(key, next);
        return next;
    } catch (error) {
        showToast(`Could not save: ${error.message}`, 'error');
        return list;
    }
}

export async function initAccessView() {
    if (!wired) {
        wired = true;
        el('adminAdd')?.addEventListener('click', addAdmin);
        el('adminEmail')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAdmin(); } });
        el('auditRoleAdd')?.addEventListener('click', addAuditRole);
        el('auditRoleInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAuditRole(); } });
        el('adminList')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-remove-admin]');
            if (btn) { admins = await removeFrom('admin_emails', admins, Number(btn.dataset.removeAdmin)); render(); }
        });
        el('auditRoleList')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-remove-audit-role]');
            if (btn) { auditRoles = await removeFrom('audit_viewer_roles', auditRoles, Number(btn.dataset.removeAuditRole)); render(); }
        });
    }
    try {
        admins = (await apiGet('/api/settings/admin_emails')).value || [];
        auditRoles = (await apiGet('/api/settings/audit_viewer_roles')).value || [];
    } catch (error) {
        showToast(`Could not load access settings: ${error.message}`, 'error');
    }
    render();
    loadTeamRoles();
    loadJobTitleChoices();
}
