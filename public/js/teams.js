/**
 * Team Management
 * Handles team CRUD operations and display
 */

import { state, elements } from './state.js';
import { showToast, getAvatarHTML, getInitials, adjustColor, escapeHtml, safeColor, safeImageSrc } from './utils.js';
import { createTeam, updateTeam, deleteTeamApi, invalidateBookingsCache, loadBookingsForMonth } from './api.js';
import { renderCalendar } from './calendar.js';
import { validateTeam, showValidationErrors } from './validation.js';
import { setButtonLoading } from './loading.js';
import { askConfirm } from './confirm.js';

/**
 * Render team select dropdown (sorted alphabetically)
 */
export function renderTeamSelect() {
    const select = elements.teamSelect;
    if (!select) return;
    
    // Filter teams for current location
    const locationTeams = state.teams
        .filter(t => t.locationId === state.currentLocation)
        .sort((a, b) => a.name.localeCompare(b.name));
    
    select.innerHTML = '<option value="">Select a team...</option>' + 
        locationTeams.map(team => 
            `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)} (${team.memberCount})</option>`
        ).join('');
}

/**
 * Render team location select dropdown
 */
export function renderTeamLocationSelect() {
    const select = document.getElementById('teamLocation');
    if (!select) return;
    
    const sortedLocations = [...state.locations].sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = sortedLocations.map(loc => 
        `<option value="${escapeHtml(loc.id)}">${escapeHtml(loc.name)}</option>`
    ).join('');
}

/**
 * Open the team modal for adding a new team
 */
export function openTeamModal() {
    // Reset form
    elements.teamForm?.reset();
    document.getElementById('teamId').value = '';
    
    // Clear manager preview
    const preview = document.getElementById('selectedManagerDisplay');
    if (preview) {
        preview.style.display = 'none';
    }
    
    // Populate location select
    renderTeamLocationSelect();
    
    // Update modal title
    const title = document.getElementById('teamModalTitle');
    if (title) title.textContent = 'Add Team';
    
    const submitBtn = document.getElementById('teamFormSubmitBtn');
    if (submitBtn) submitBtn.textContent = 'Add Team';
    
    // Show modal
    elements.teamModal?.classList.add('active');
}

/**
 * Render the teams list in settings
 */
export function renderTeamsList() {
    const container = document.getElementById('teamsList');
    if (!container) return;
    
    // Group teams by location
    const teamsByLocation = {};
    state.teams.forEach(team => {
        const locId = team.locationId || 'unassigned';
        if (!teamsByLocation[locId]) {
            teamsByLocation[locId] = [];
        }
        teamsByLocation[locId].push(team);
    });
    
    // Sort locations
    const sortedLocations = [...state.locations].sort((a, b) => a.name.localeCompare(b.name));
    
    let html = '';
    
    sortedLocations.forEach(location => {
        const locTeams = teamsByLocation[location.id] || [];
        if (locTeams.length === 0) return;
        
        // Sort teams within location
        locTeams.sort((a, b) => a.name.localeCompare(b.name));
        
        html += `<div class="location-group">
            <h4 class="location-group-title">${escapeHtml(location.name)}</h4>
            <div class="teams-grid">`;
        
        locTeams.forEach(team => {
            const avatarHtml = getAvatarHTML(team.manager, team.managerImage, team.color, 'team-card-avatar');
            
            html += `
                <div class="team-card">
                    <div class="team-card-header" style="background: linear-gradient(135deg, ${safeColor(team.color, '#6B7280')}, ${adjustColor(team.color, -30)})">
                        ${avatarHtml}
                        <div class="team-card-info">
                            <h4>${escapeHtml(team.name)}</h4>
                            <span class="team-member-count">${escapeHtml(team.memberCount)} members</span>
                        </div>
                    </div>
                    ${team.manager ? `<div class="team-manager-row"><span>Manager:</span> ${escapeHtml(team.manager)}</div>` : ''}
                    <div class="team-card-actions">
                        <button class="btn btn-sm" onclick="editTeam('${escapeHtml(team.id)}')">Edit</button>
                        <button class="btn btn-sm btn-danger admin-only" onclick="deleteTeam('${escapeHtml(team.id)}')">Delete</button>
                    </div>
                </div>
            `;
        });
        
        html += '</div></div>';
    });
    
    // Unassigned teams
    const unassigned = teamsByLocation['unassigned'] || [];
    if (unassigned.length > 0) {
        html += `<div class="location-group">
            <h4 class="location-group-title">Unassigned</h4>
            <div class="teams-grid">`;
        
        unassigned.sort((a, b) => a.name.localeCompare(b.name)).forEach(team => {
            const avatarHtml = getAvatarHTML(team.manager, team.managerImage, team.color, 'team-card-avatar');
            
            html += `
                <div class="team-card">
                    <div class="team-card-header" style="background: linear-gradient(135deg, ${safeColor(team.color, '#6B7280')}, ${adjustColor(team.color, -30)})">
                        ${avatarHtml}
                        <div class="team-card-info">
                            <h4>${escapeHtml(team.name)}</h4>
                            <span class="team-member-count">${escapeHtml(team.memberCount)} members</span>
                        </div>
                    </div>
                    ${team.manager ? `<div class="team-manager-row"><span>Manager:</span> ${escapeHtml(team.manager)}</div>` : ''}
                    <div class="team-card-actions">
                        <button class="btn btn-sm" onclick="editTeam('${escapeHtml(team.id)}')">Edit</button>
                        <button class="btn btn-sm btn-danger admin-only" onclick="deleteTeam('${escapeHtml(team.id)}')">Delete</button>
                    </div>
                </div>
            `;
        });
        
        html += '</div></div>';
    }
    
    if (html === '') {
        html = '<p class="no-data">No teams created yet</p>';
    }
    
    container.innerHTML = html;
}

/**
 * Handle team form submission
 */
export async function handleTeamSubmit(e) {
    e.preventDefault();
    
    const teamId = document.getElementById('teamId')?.value;
    const name = document.getElementById('teamName')?.value;
    const color = document.getElementById('teamColor')?.value;
    const memberCount = parseInt(document.getElementById('teamMemberCount')?.value) || 1;
    const manager = document.getElementById('teamManager')?.value || '';
    const managerImage = document.getElementById('teamManagerImage')?.value || '';
    const locationId = document.getElementById('teamLocation')?.value;
    
    // Frontend validation
    const validation = validateTeam({ name, color, memberCount, manager, locationId });
    if (!showValidationErrors(validation, showToast)) {
        return;
    }
    
    // Get submit button and set loading state
    const submitBtn = document.getElementById('teamFormSubmitBtn');
    const restoreBtn = setButtonLoading(submitBtn, teamId ? 'Updating...' : 'Creating...');
    
    try {
        if (teamId) {
            // Update
            const updated = await updateTeam(teamId, { name, color, memberCount, manager, managerImage, locationId });
            const idx = state.teams.findIndex(t => t.id === teamId);
            if (idx !== -1) state.teams[idx] = updated;
            showToast('Team updated');
        } else {
            // Create
            const newTeam = await createTeam({ name, color, memberCount, manager, managerImage, locationId });
            state.teams.push(newTeam);
            showToast('Team created');
        }
        
        renderTeamsList();
        renderTeamSelect();
        closeTeamModal();
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        restoreBtn();
    }
}

/**
 * Edit an existing team
 */
export function editTeam(id) {
    const team = state.teams.find(t => t.id === id);
    if (!team) return;
    
    // Populate location select first
    renderTeamLocationSelect();
    
    document.getElementById('teamId').value = team.id;
    document.getElementById('teamName').value = team.name;
    document.getElementById('teamColor').value = team.color;
    document.getElementById('teamMemberCount').value = team.memberCount;
    document.getElementById('teamManager').value = team.manager || '';
    document.getElementById('teamManagerImage').value = team.managerImage || '';
    document.getElementById('teamLocation').value = team.locationId || '';
    
    // Update modal title and button for editing
    const title = document.getElementById('teamModalTitle');
    if (title) title.textContent = 'Edit Team';
    
    const submitBtn = document.getElementById('teamFormSubmitBtn');
    if (submitBtn) submitBtn.textContent = 'Update Team';
    
    // Update manager preview
    const preview = document.getElementById('selectedManagerPreview');
    if (preview && team.manager) {
        preview.innerHTML = `
            <div class="selected-manager-info">
                ${safeImageSrc(team.managerImage) ? `<img src="${escapeHtml(safeImageSrc(team.managerImage))}" alt="${escapeHtml(team.manager)}">` : `<div class="manager-photo-placeholder">${escapeHtml(team.manager.charAt(0))}</div>`}
                <div>
                    <strong>${escapeHtml(team.manager)}</strong>
                </div>
            </div>
            <button type="button" class="btn btn-sm" onclick="clearSelectedManager()">Clear</button>
        `;
        preview.style.display = 'flex';
    }
    
    elements.teamModal?.classList.add('active');
}

/**
 * Delete a team
 */
export async function deleteTeam(id) {
    const team = state.teams.find(t => t.id === id);
    if (!team) return;
    
    if (!await askConfirm(`Delete team "${team.name}"? This will also delete all their bookings.`, { title: 'Delete team' })) return;
    
    try {
        await deleteTeamApi(id);
        
        state.teams = state.teams.filter(t => t.id !== id);
        state.bookings = state.bookings.filter(b => b.teamId !== id);
        invalidateBookingsCache();
        
        await loadBookingsForMonth(true);
        renderTeamsList();
        renderTeamSelect();
        renderCalendar();
        
        showToast('Team deleted');
    } catch (error) {
        showToast('Failed to delete team', 'error');
    }
}

/**
 * Close team modal
 */
export function closeTeamModal() {
    elements.teamModal?.classList.remove('active');
    elements.teamForm?.reset();
    document.getElementById('teamId').value = '';
    
    const preview = document.getElementById('selectedManagerPreview');
    if (preview) {
        preview.style.display = 'none';
        preview.innerHTML = '';
    }
}

/**
 * Clear selected manager
 */
export function clearSelectedManager() {
    document.getElementById('teamManager').value = '';
    document.getElementById('teamManagerImage').value = '';
    
    const preview = document.getElementById('selectedManagerPreview');
    if (preview) {
        preview.style.display = 'none';
        preview.innerHTML = '';
    }
}

/**
 * Show team tooltip on hover
 */
export function showTeamTooltip(event, teamId) {
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;
    
    let tooltip = document.getElementById('teamTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'teamTooltip';
        tooltip.className = 'team-tooltip';
        document.body.appendChild(tooltip);
    }
    
    const avatarHtml = getAvatarHTML(team.manager, team.managerImage, team.color, 'tooltip-avatar');
    
    tooltip.innerHTML = `
        <div class="tooltip-header" style="background: linear-gradient(135deg, ${safeColor(team.color, '#6B7280')}, ${adjustColor(team.color, -30)})">
            ${avatarHtml}
            <div class="tooltip-info">
                <strong>${escapeHtml(team.name)}</strong>
                <span>${escapeHtml(team.memberCount)} members</span>
            </div>
        </div>
        ${team.manager ? `<div class="tooltip-manager">Manager: ${escapeHtml(team.manager)}</div>` : ''}
    `;
    
    // Position tooltip
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 8}px`;
    tooltip.classList.add('visible');
}

/**
 * Hide team tooltip
 */
export function hideTeamTooltip() {
    const tooltip = document.getElementById('teamTooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

