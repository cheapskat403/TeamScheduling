/**
 * Azure AD Manager Selector
 * Integration for selecting team managers from Azure AD
 */

import { showToast, escapeHtml } from './utils.js';
import { apiGet, apiPut } from './fetch-utils.js';

// Allowed team roles (job titles that can lead teams)
let allowedTeamRoles = [];
let rolesLoaded = false;

/**
 * Load team roles from the database
 */
async function loadTeamRoles() {
    if (rolesLoaded) return;
    
    try {
        const response = await apiGet('/api/settings/team_roles');
        if (response && response.value) {
            allowedTeamRoles = response.value;
        }
        rolesLoaded = true;
    } catch (error) {
        console.error('Error loading team roles:', error);
        // Fallback to localStorage for migration
        const localRoles = localStorage.getItem('allowedTeamRoles');
        if (localRoles) {
            allowedTeamRoles = JSON.parse(localRoles);
            // Migrate to database
            await saveTeamRolesToDB(allowedTeamRoles);
            localStorage.removeItem('allowedTeamRoles');
        }
        rolesLoaded = true;
    }
}

/**
 * Save team roles to the database
 */
async function saveTeamRolesToDB(roles) {
    try {
        await apiPut('/api/settings/team_roles', { value: roles });
    } catch (error) {
        console.error('Error saving team roles:', error);
        showToast('Failed to save team roles', 'error');
    }
}

/**
 * Get allowed team roles
 */
export function getAllowedTeamRoles() {
    return allowedTeamRoles;
}

/**
 * Set allowed team roles
 */
export async function setAllowedTeamRoles(roles) {
    allowedTeamRoles = roles;
    await saveTeamRolesToDB(roles);
}

/**
 * Initialize team roles view
 */
export async function initTeamRolesView() {
    await loadTeamRoles();
    await renderJobTitlesList();
    renderAllowedRolesList();
}

// Store all job titles from Azure AD
let allJobTitles = [];

/**
 * Render available job titles from Azure AD
 */
export async function renderJobTitlesList() {
    const container = document.getElementById('jobTitlesList');
    if (!container) {
        console.error('jobTitlesList container not found');
        return;
    }
    
    container.innerHTML = '<div class="loading-row"><div class="loading-spinner"></div><span>Loading job titles from Azure AD...</span></div>';
    
    try {
        if (typeof fetchAllJobTitles !== 'function') {
            container.innerHTML = '<p class="error">Azure AD not available. Please sign in with Azure AD first.</p>';
            return;
        }
        
        allJobTitles = await fetchAllJobTitles();
        
        if (!allJobTitles || allJobTitles.length === 0) {
            container.innerHTML = '<p class="no-data">No job titles found in Azure AD.</p>';
            return;
        }
        
        renderAvailableTitles();
        
    } catch (error) {
        console.error('Error loading job titles:', error);
        container.innerHTML = '<p class="error">Failed to load job titles from Azure AD.</p>';
    }
}

/**
 * Render only available (unselected) titles
 */
function renderAvailableTitles() {
    const container = document.getElementById('jobTitlesList');
    if (!container) return;
    
    // Filter out already selected roles
    const availableTitles = allJobTitles.filter(title => !allowedTeamRoles.includes(title));
    
    if (availableTitles.length === 0) {
        container.innerHTML = '<p class="no-data">All job titles have been added to allowed roles.</p>';
        return;
    }
    
    container.innerHTML = availableTitles.map(title => `
        <div class="job-title-item" data-role="${escapeHtml(title)}" onclick="toggleTeamRole('${escapeHtml(title)}', this)">
            <span>${escapeHtml(title)}</span>
            <button class="add-role-btn" title="Add to allowed roles">
                <span class="btn-text">+</span>
                <span class="btn-spinner-small"></span>
            </button>
        </div>
    `).join('');
}

/**
 * Render currently allowed roles
 */
export function renderAllowedRolesList() {
    const container = document.getElementById('allowedRolesList');
    if (!container) return;
    
    if (allowedTeamRoles.length === 0) {
        container.innerHTML = '<p class="no-data">No roles selected. Click on job titles from the left to add them.</p>';
        return;
    }
    
    // Sort alphabetically
    const sortedRoles = [...allowedTeamRoles].sort((a, b) => a.localeCompare(b));
    
    container.innerHTML = sortedRoles.map(role => `
        <div class="allowed-role-item" data-role="${escapeHtml(role)}">
            <span>${escapeHtml(role)}</span>
            <button class="remove-role-btn" onclick="toggleTeamRole('${escapeHtml(role)}', this.parentElement)" title="Remove">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span class="btn-spinner-small"></span>
            </button>
        </div>
    `).join('');
}

// Track saving state to prevent double-clicks
let isSaving = false;

/**
 * Toggle a team role with animation
 */
export async function toggleTeamRole(title, element) {
    // Prevent double-clicks
    if (isSaving) return;
    isSaving = true;
    
    // Add saving animation to the element
    if (element) {
        element.classList.add('saving');
    }
    
    const isAdding = !allowedTeamRoles.includes(title);
    const idx = allowedTeamRoles.indexOf(title);
    
    if (idx === -1) {
        allowedTeamRoles.push(title);
    } else {
        allowedTeamRoles.splice(idx, 1);
    }
    
    try {
        await setAllowedTeamRoles(allowedTeamRoles);
        
        // Add success animation before removing
        if (element) {
            element.classList.remove('saving');
            element.classList.add('success');
            
            // Animate out
            await new Promise(r => setTimeout(r, 300));
        }
        
        renderAvailableTitles();
        renderAllowedRolesList();
        
        // Show subtle toast
        showToast(isAdding ? `Added "${title}" as team lead role` : `Removed "${title}" from team lead roles`, 'success');
    } catch (error) {
        // Revert on error
        if (idx === -1) {
            allowedTeamRoles.pop();
        } else {
            allowedTeamRoles.splice(idx, 0, title);
        }
        
        if (element) {
            element.classList.remove('saving');
            element.classList.add('error');
            await new Promise(r => setTimeout(r, 500));
            element.classList.remove('error');
        }
    } finally {
        isSaving = false;
    }
}

/**
 * Fetch managers from Azure AD based on allowed roles
 */
export async function fetchAzureADManagers() {
    await loadTeamRoles();
    
    if (allowedTeamRoles.length === 0) {
        return [];
    }
    
    try {
        if (typeof fetchUsersByJobTitles !== 'function') {
            console.warn('Azure AD functions not available');
            return [];
        }
        
        const users = await fetchUsersByJobTitles(allowedTeamRoles);
        return users || [];
    } catch (error) {
        console.error('Error fetching Azure AD managers:', error);
        return [];
    }
}

/**
 * Get direct reports count for a manager
 */
export async function getManagerDirectReportsCount(managerId) {
    try {
        if (typeof fetchDirectReportsCount !== 'function') {
            return 0;
        }
        return await fetchDirectReportsCount(managerId);
    } catch (error) {
        console.error('Error fetching direct reports:', error);
        return 0;
    }
}

/**
 * Open manager selector dropdown
 */
export async function openManagerSelector() {
    const dropdown = document.getElementById('managerDropdown');
    if (!dropdown) return;
    
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="dropdown-loading"><div class="loading-spinner"></div><span>Loading managers from Azure AD...</span></div>';
    
    // Add click outside listener
    document.addEventListener('click', closeManagerDropdownOnClickOutside);
    
    try {
        const managers = await fetchAzureADManagers();
        
        if (managers.length === 0) {
            dropdown.innerHTML = `
                <div class="dropdown-empty">
                    <p>No team lead roles configured.</p>
                    <p class="hint">Go to Settings → Team Roles to select which job titles can lead teams.</p>
                </div>
            `;
        } else {
            // Sort managers alphabetically
            managers.sort((a, b) => a.displayName.localeCompare(b.displayName));
            
            // Render managers first, then load photos
            dropdown.innerHTML = managers.map(m => `
                <div class="manager-option" data-manager-id="${m.id}" onclick="selectManager('${m.id}', '${escapeHtml(m.displayName)}', '${escapeHtml(m.jobTitle || '')}', '${escapeHtml(m.mail || '')}')">
                    <div class="manager-photo-placeholder" data-photo-id="${m.id}">${m.displayName.charAt(0)}</div>
                    <div class="manager-info">
                        <strong>${escapeHtml(m.displayName)}</strong>
                        <span>${escapeHtml(m.jobTitle || 'No title')}</span>
                    </div>
                </div>
            `).join('');
            
            // Load photos asynchronously
            loadManagerPhotos(managers);
        }
    } catch (error) {
        dropdown.innerHTML = '<p class="error">Failed to load managers</p>';
    }
}

/**
 * Load manager photos asynchronously
 */
async function loadManagerPhotos(managers) {
    for (const manager of managers) {
        try {
            if (typeof fetchUserPhotoById === 'function') {
                const photoUrl = await fetchUserPhotoById(manager.id);
                if (photoUrl) {
                    const placeholder = document.querySelector(`[data-photo-id="${manager.id}"]`);
                    if (placeholder) {
                        const img = document.createElement('img');
                        img.src = photoUrl;
                        img.alt = manager.displayName;
                        img.className = 'manager-photo';
                        placeholder.replaceWith(img);
                    }
                }
            }
        } catch (error) {
            // Photo failed to load, keep placeholder
        }
    }
}

/**
 * Close manager dropdown
 */
export function closeManagerDropdown() {
    const dropdown = document.getElementById('managerDropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    document.removeEventListener('click', closeManagerDropdownOnClickOutside);
}

/**
 * Close dropdown when clicking outside
 */
function closeManagerDropdownOnClickOutside(e) {
    const dropdown = document.getElementById('managerDropdown');
    const btn = document.getElementById('selectManagerBtn');
    
    if (dropdown && !dropdown.contains(e.target) && !btn?.contains(e.target)) {
        closeManagerDropdown();
    }
}

/**
 * Select a manager from the dropdown
 */
export async function selectManager(id, name, title, email) {
    document.getElementById('teamManager').value = name;
    
    // Fetch photo and direct reports count
    let photoUrl = '';
    let directReportsCount = 0;
    
    try {
        // Fetch photo
        if (typeof window.fetchUserPhotoById === 'function') {
            try {
                photoUrl = await window.fetchUserPhotoById(id);
            } catch (e) {
                // Photo fetch failed, use placeholder
            }
        }
        
        // Fetch direct reports count
        if (typeof window.fetchDirectReportsCount === 'function') {
            try {
                directReportsCount = await window.fetchDirectReportsCount(id);
            } catch (e) {
                // Direct reports fetch failed
            }
        }
    } catch (error) {
        console.warn('Error fetching manager data:', error);
    }
    
    document.getElementById('teamManagerImage').value = photoUrl;
    
    // Auto-populate team member count with direct reports (user can still override)
    const memberCountInput = document.getElementById('teamMemberCount');
    if (memberCountInput && directReportsCount > 0) {
        memberCountInput.value = directReportsCount;
        showToast(`Team size set to ${directReportsCount} based on direct reports`, 'success');
    }
    
    // Update preview
    const preview = document.getElementById('selectedManagerPreview');
    if (preview) {
        preview.innerHTML = `
            <div class="selected-manager-info">
                ${photoUrl ? `<img src="${photoUrl}" alt="${name}">` : `<div class="manager-photo-placeholder">${name.charAt(0)}</div>`}
                <div>
                    <strong>${name}</strong>
                    ${title ? `<span>${title}</span>` : ''}
                    ${directReportsCount > 0 ? `<span class="direct-reports-hint">${directReportsCount} direct reports</span>` : ''}
                </div>
            </div>
            <button type="button" class="btn btn-sm" onclick="clearSelectedManager()">Clear</button>
        `;
        preview.style.display = 'flex';
    }
    
    closeManagerDropdown();
}

