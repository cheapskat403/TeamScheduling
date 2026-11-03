/**
 * Location Management
 * Handles location CRUD operations and display
 */

import { state, elements } from './state.js';
import { showToast, escapeHtml } from './utils.js';
import { createLocation, updateLocation, deleteLocationApi } from './api.js';
import { renderTeamSelect } from './teams.js';
import { validateLocation, showValidationErrors } from './validation.js';
import { setButtonLoading } from './loading.js';
import { askConfirm } from './confirm.js';

/**
 * Render location select dropdown (sorted alphabetically)
 */
export function renderLocationSelect() {
    const select = elements.locationSelect;
    if (!select) return;
    
    const sortedLocations = [...state.locations].sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = sortedLocations.map(loc => 
        `<option value="${escapeHtml(loc.id)}" ${loc.id === state.currentLocation ? 'selected' : ''}>${escapeHtml(loc.name)}</option>`
    ).join('');
}

/**
 * Render the locations list in settings
 */
export function renderLocationsList() {
    const container = document.getElementById('locationsList');
    if (!container) return;
    
    const sortedLocations = [...state.locations].sort((a, b) => a.name.localeCompare(b.name));
    
    if (sortedLocations.length === 0) {
        container.innerHTML = '<p class="no-data">No locations created yet</p>';
        return;
    }
    
    container.innerHTML = sortedLocations.map(loc => `
        <div class="location-card">
            <div class="location-card-header">
                <div class="location-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                </div>
                <div class="location-card-info">
                    <h4>${escapeHtml(loc.name)}</h4>
                    <span class="location-capacity">${loc.capacity} people capacity</span>
                </div>
            </div>
            ${loc.address ? `<div class="location-detail"><span>Address:</span> ${escapeHtml(loc.address)}</div>` : ''}
            ${loc.floors > 1 ? `<div class="location-detail"><span>Floors:</span> ${loc.floors}</div>` : ''}
            <div class="location-card-actions">
                <button class="btn btn-sm" onclick="editLocation('${escapeHtml(loc.id)}')">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteLocation('${escapeHtml(loc.id)}')">Delete</button>
            </div>
        </div>
    `).join('');
}

/**
 * Handle location form submission
 */
export async function handleLocationSubmit(e) {
    e.preventDefault();
    
    const locationId = document.getElementById('editLocationId')?.value;
    const name = document.getElementById('locationName')?.value;
    const address = document.getElementById('locationAddress')?.value || '';
    const capacity = parseInt(document.getElementById('locationCapacity')?.value) || 21;
    const floors = parseInt(document.getElementById('locationFloors')?.value) || 1;
    
    // Frontend validation
    const validation = validateLocation({ name, address, capacity, floors });
    if (!showValidationErrors(validation, showToast)) {
        return;
    }
    
    // Get submit button and set loading state
    const submitBtn = document.getElementById('locationFormSubmitBtn');
    const restoreBtn = setButtonLoading(submitBtn, locationId ? 'Updating...' : 'Creating...');
    
    try {
        if (locationId) {
            // Update
            const updated = await updateLocation(locationId, { name, address, capacity, floors });
            const idx = state.locations.findIndex(l => l.id === locationId);
            if (idx !== -1) state.locations[idx] = updated;
            showToast('Location updated');
        } else {
            // Create
            const newLocation = await createLocation({ name, address, capacity, floors });
            state.locations.push(newLocation);
            showToast('Location created');
        }
        
        renderLocationsList();
        renderLocationSelect();
        renderTeamSelect();
        closeLocationModal();
        window.updateCapacityDisplay?.();
        
    } catch (error) {
        showToast(error.message || 'Failed to save location', 'error');
    } finally {
        restoreBtn();
    }
}

/**
 * Edit an existing location
 */
export function editLocation(id) {
    const location = state.locations.find(l => l.id === id);
    if (!location) return;
    
    // Try direct DOM access as fallback
    const modal = elements.locationModal || document.getElementById('locationModal');
    
    document.getElementById('editLocationId').value = location.id;
    document.getElementById('locationName').value = location.name;
    document.getElementById('locationAddress').value = location.address || '';
    document.getElementById('locationCapacity').value = location.capacity;
    document.getElementById('locationFloors').value = location.floors || 1;
    
    // Update modal title and button for editing
    const title = document.getElementById('locationModalTitle');
    if (title) title.textContent = 'Edit Location';
    
    const submitBtn = document.getElementById('locationFormSubmitBtn');
    if (submitBtn) submitBtn.textContent = 'Update Location';
    
    if (modal) {
        modal.classList.add('active');
    }
}

/**
 * Delete a location
 */
export async function deleteLocation(id) {
    const location = state.locations.find(l => l.id === id);
    if (!location) return;
    
    if (!await askConfirm(`Delete location "${location.name}"? This will delete all bookings at this location.`, { title: 'Delete location' })) return;
    
    try {
        await deleteLocationApi(id);
        
        state.locations = state.locations.filter(l => l.id !== id);
        
        // Update current location if needed
        if (state.currentLocation === id && state.locations.length > 0) {
            state.currentLocation = state.locations[0].id;
        }
        
        renderLocationsList();
        renderLocationSelect();
        window.renderCalendar?.();
        window.updateCapacityDisplay?.();
        
        showToast('Location deleted');
    } catch (error) {
        showToast('Failed to delete location', 'error');
    }
}

/**
 * Close location modal
 */
/**
 * Open the location modal for adding a new location
 */
export function openLocationModal() {
    // Try direct DOM access as fallback
    const modal = elements.locationModal || document.getElementById('locationModal');
    
    // Reset form
    const form = elements.locationForm || document.getElementById('locationForm');
    form?.reset();
    
    const locationIdInput = document.getElementById('editLocationId');
    if (locationIdInput) locationIdInput.value = '';
    
    // Update modal title and button
    const title = document.getElementById('locationModalTitle');
    if (title) title.textContent = 'Add Location';
    
    const submitBtn = document.getElementById('locationFormSubmitBtn');
    if (submitBtn) submitBtn.textContent = 'Add Location';
    
    // Show modal
    if (modal) {
        modal.classList.add('active');
    }
}

/**
 * Close the location modal
 */
export function closeLocationModal() {
    elements.locationModal?.classList.remove('active');
    elements.locationForm?.reset();
    const locationIdInput = document.getElementById('editLocationId');
    if (locationIdInput) locationIdInput.value = '';
}

/**
 * Update capacity display in header
 * Always shows TODAY's capacity for the selected location
 */
export async function updateCapacityDisplay() {
    const location = state.locations.find(l => l.id === state.currentLocation);
    if (!location) return;
    
    const capacity = location.capacity;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // Check if today's bookings are in the current state (might not be if viewing different month)
    let todayBookings = state.bookings.filter(b => b.date === todayStr && b.locationId === state.currentLocation);
    
    // If no bookings found and we're viewing a different month, fetch today's bookings directly
    const currentMonth = state.currentDate.getMonth();
    const currentYear = state.currentDate.getFullYear();
    if (todayBookings.length === 0 && (today.getMonth() !== currentMonth || today.getFullYear() !== currentYear)) {
        try {
            const response = await fetch(`/api/bookings?locationId=${state.currentLocation}&date=${todayStr}`);
            if (response.ok) {
                todayBookings = await response.json();
            }
        } catch (error) {
            console.error('Failed to fetch today\'s bookings:', error);
        }
    }
    
    const totalPeople = todayBookings.reduce((sum, b) => {
        const team = state.teams.find(t => t.id === b.teamId);
        return sum + (team ? team.memberCount : b.peopleCount);
    }, 0);
    
    const percentage = Math.min((totalPeople / capacity) * 100, 100);
    
    if (elements.capacityLabel) {
        // Just show the numbers - "Today's Capacity" is already in the HTML label
        elements.capacityLabel.textContent = `${totalPeople}/${capacity}`;
    }
    
    if (elements.capacityFill) {
        elements.capacityFill.style.width = `${percentage}%`;
        
        elements.capacityFill.classList.remove('warning', 'full');
        if (percentage >= 100) {
            elements.capacityFill.classList.add('full');
        } else if (percentage >= 80) {
            elements.capacityFill.classList.add('warning');
        }
    }
}

