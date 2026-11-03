/**
 * Booking Management
 * Handles booking modal, CRUD operations, and capacity checking
 */

import { state, elements } from './state.js';
import { formatDateStr, formatDisplayDate, showToast, getBookingPeopleCount, getInitials, escapeHtml, safeColor } from './utils.js';
import { createBooking, updateBooking, deleteBookingApi, invalidateBookingsCache, loadBookingsForMonth } from './api.js';
import { renderCalendar } from './calendar.js';
import { validateBooking, showValidationErrors } from './validation.js';
import { setButtonLoading } from './loading.js';
import { askConfirm } from './confirm.js';

// Track if currently overbooking
let isOverbooking = false;

/**
 * Open the booking modal for a specific date
 */
export function openBookingModal(dateStr) {
    const modal = elements.bookingModal;
    if (!modal) return;
    
    state.selectedDate = dateStr;
    
    // Update modal title
    const title = document.getElementById('modalTitle');
    if (title) {
        title.textContent = `Bookings for ${formatDisplayDate(dateStr)}`;
    }
    
    // Update date display
    const selectedDateDiv = document.getElementById('selectedDate');
    if (selectedDateDiv) {
        selectedDateDiv.textContent = formatDisplayDate(dateStr);
    }
    
    // Update date input
    const dateInput = document.getElementById('bookingDate');
    if (dateInput) dateInput.value = dateStr;
    
    // Render existing bookings
    renderDayBookings(dateStr);
    
    // Update available spots hint
    updateAvailableSpotsHint(dateStr);
    
    // Reset form but keep the date
    elements.bookingForm?.reset();
    document.getElementById('bookingId').value = '';
    if (dateInput) dateInput.value = dateStr;
    
    // Clear team info
    const teamInfo = document.getElementById('bookingTeamInfo');
    if (teamInfo) teamInfo.textContent = '';
    
    hideOverbookingWarning();
    
    // Show modal
    modal.classList.add('active');
}

/**
 * Close the booking modal
 */
export function closeModal() {
    elements.bookingModal?.classList.remove('active');
    hideOverbookingWarning();
}

/**
 * Render bookings for a specific day in the modal
 */
export function renderDayBookings(dateStr) {
    // Use dayBookingsList if it exists, otherwise dayBookings
    let container = document.getElementById('dayBookingsList');
    if (!container) {
        container = document.getElementById('dayBookings');
    }
    if (!container) return;
    
    const dayBookings = state.bookings.filter(b => b.date === dateStr);
    
    if (dayBookings.length === 0) {
        container.innerHTML = '<p class="no-bookings">No bookings for this day</p>';
        return;
    }
    
    // Sort by team name
    const sortedBookings = [...dayBookings].sort((a, b) => {
        const teamA = state.teams.find(t => t.id === a.teamId);
        const teamB = state.teams.find(t => t.id === b.teamId);
        const nameA = teamA ? teamA.name : a.teamName || '';
        const nameB = teamB ? teamB.name : b.teamName || '';
        return nameA.localeCompare(nameB);
    });
    
    container.innerHTML = sortedBookings.map(booking => {
        const team = state.teams.find(t => t.id === booking.teamId);
        const color = team ? team.color : '#6B7280';
        const displayName = team ? team.name : booking.teamName;
        const displayCount = team ? team.memberCount : booking.peopleCount;
        const isOverbooked = booking.notes && booking.notes.startsWith('[OVERBOOKED]');
        const notes = isOverbooked ? booking.notes.replace('[OVERBOOKED] ', '') : booking.notes;
        
        return `
            <div class="booking-item ${isOverbooked ? 'overbooked' : ''}" style="background: ${safeColor(color, '#6B7280')};">
                <div class="booking-header">
                    <div class="booking-info">
                        <strong>${escapeHtml(displayName)}</strong>
                        <span>${displayCount} people</span>
                        ${isOverbooked ? '<span class="overbooked-icon" title="Overbooked">⚠️</span>' : ''}
                    </div>
                    <div class="booking-actions">
                        <button class="btn-icon calendar-edit" onclick="editBooking('${escapeHtml(booking.id)}')" title="Edit">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon danger calendar-edit" onclick="deleteBooking('${escapeHtml(booking.id)}')" title="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                        <div class="calendar-sync-buttons">
                            <button class="btn-icon" onclick="addToOutlookCalendar('${escapeHtml(booking.id)}')" title="Add to Outlook Calendar">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                    <line x1="16" y1="2" x2="16" y2="6"></line>
                                    <line x1="8" y1="2" x2="8" y2="6"></line>
                                    <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                            </button>
                            <button class="btn-icon" onclick="downloadICS('${escapeHtml(booking.id)}')" title="Download Calendar File (.ics)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                ${notes ? `<div class="booking-notes">${escapeHtml(notes)}</div>` : ''}
            </div>
        `;
    }).join('');
}

/**
 * Update the available spots hint
 */
export function updateAvailableSpotsHint(dateStr) {
    const hint = document.getElementById('availableSpots');
    if (!hint) return;
    
    const location = state.locations.find(l => l.id === state.currentLocation);
    const capacity = location ? location.capacity : 21;
    const dayBookings = state.bookings.filter(b => b.date === dateStr);
    const total = dayBookings.reduce((sum, b) => sum + getBookingPeopleCount(b, state.teams), 0);
    const available = capacity - total;
    
    hint.textContent = `Available spots: ${available} of ${capacity}`;
    hint.className = available <= 0 ? 'hint full' : (available <= 5 ? 'hint warning' : 'hint');
}

/**
 * Check if adding a booking would exceed capacity
 */
export function checkOverbooking() {
    const teamId = elements.teamSelect?.value;
    const dateStr = document.getElementById('bookingDate')?.value;
    const bookingId = document.getElementById('bookingId')?.value;
    
    if (!teamId || !dateStr) {
        hideOverbookingWarning();
        return;
    }
    
    const team = state.teams.find(t => t.id === teamId);
    const peopleCount = team ? team.memberCount : 1;
    
    const location = state.locations.find(l => l.id === state.currentLocation);
    const capacity = location ? location.capacity : 21;
    
    // Calculate current total (excluding the booking being edited)
    const dayBookings = state.bookings.filter(b => b.date === dateStr && b.id !== bookingId);
    const currentTotal = dayBookings.reduce((sum, b) => sum + getBookingPeopleCount(b, state.teams), 0);
    
    const newTotal = currentTotal + peopleCount;
    
    if (newTotal > capacity) {
        const excess = newTotal - capacity;
        showOverbookingWarning(newTotal, capacity, excess);
        isOverbooking = true;
    } else {
        hideOverbookingWarning();
        isOverbooking = false;
    }
}

/**
 * Show overbooking warning
 */
function showOverbookingWarning(total, capacity, excess) {
    const warning = document.getElementById('overbookingWarning');
    const notesLabel = document.getElementById('notesRequiredLabel');
    const notesInput = document.getElementById('bookingNotes');
    
    if (warning) {
        warning.style.display = 'block';
        warning.innerHTML = `
            <strong>⚠️ Over capacity!</strong>
            <p>This booking would put the office at ${total}/${capacity} (${excess} over capacity).</p>
            <p>Please provide a reason for overbooking.</p>
        `;
    }
    
    if (notesLabel) {
        notesLabel.textContent = ' (required for overbooking)';
        notesLabel.style.color = 'var(--warning)';
    }
    
    if (notesInput) {
        notesInput.setAttribute('required', 'required');
    }
}

/**
 * Hide overbooking warning
 */
function hideOverbookingWarning() {
    const warning = document.getElementById('overbookingWarning');
    const notesLabel = document.getElementById('notesRequiredLabel');
    const notesInput = document.getElementById('bookingNotes');
    
    if (warning) {
        warning.style.display = 'none';
    }
    
    if (notesLabel) {
        notesLabel.textContent = '';
    }
    
    if (notesInput) {
        notesInput.removeAttribute('required');
    }
    
    isOverbooking = false;
}

/**
 * Handle booking form submission
 */
export async function handleBookingSubmit(e) {
    e.preventDefault();
    
    const bookingId = document.getElementById('bookingId')?.value;
    const date = document.getElementById('bookingDate')?.value;
    const teamId = elements.teamSelect?.value;
    const notes = document.getElementById('bookingNotes')?.value || '';
    
    // Frontend validation
    const validation = validateBooking({ date, teamId, notes });
    if (!showValidationErrors(validation, showToast)) {
        return;
    }
    
    if (isOverbooking && !notes.trim()) {
        showToast('Please provide a reason for overbooking', 'error');
        document.getElementById('bookingNotes')?.focus();
        return;
    }
    
    const team = state.teams.find(t => t.id === teamId);
    const peopleCount = team ? team.memberCount : 1;
    
    // Get submit button and set loading state
    const submitBtn = elements.bookingForm?.querySelector('button[type="submit"]');
    const restoreBtn = setButtonLoading(submitBtn, bookingId ? 'Updating...' : 'Creating...');
    
    try {
        if (bookingId) {
            // Update existing
            await updateBooking(bookingId, {
                date,
                teamId,
                teamName: team?.name,
                peopleCount,
                locationId: state.currentLocation,
                notes
            });
            showToast('Booking updated');
        } else {
            // Create new
            await createBooking({
                date,
                teamId,
                teamName: team?.name,
                peopleCount,
                locationId: state.currentLocation,
                notes
            });
            showToast('Booking created');
        }
        
        // Refresh data
        invalidateBookingsCache();
        await loadBookingsForMonth(true);
        renderCalendar();
        renderDayBookings(date);
        updateAvailableSpotsHint(date);
        window.updateCapacityDisplay?.();
        
        // Reset form
        elements.bookingForm?.reset();
        document.getElementById('bookingId').value = '';
        hideOverbookingWarning();
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        restoreBtn();
    }
}

/**
 * Edit an existing booking
 */
export function editBooking(id) {
    const booking = state.bookings.find(b => b.id === id);
    if (!booking) return;
    
    document.getElementById('bookingId').value = booking.id;
    elements.teamSelect.value = booking.teamId;
    
    const notes = booking.notes?.startsWith('[OVERBOOKED]') 
        ? booking.notes.replace('[OVERBOOKED] ', '') 
        : booking.notes || '';
    document.getElementById('bookingNotes').value = notes;
    
    checkOverbooking();
}

/**
 * Delete a booking
 */
export async function deleteBooking(id) {
    const booking = state.bookings.find(b => b.id === id);
    const team = booking && state.teams.find(t => t.id === booking.teamId);
    const what = booking ? `the booking for ${(team && team.name) || booking.teamName} on ${formatDisplayDate(booking.date)}` : 'this booking';
    if (!await askConfirm(`Delete ${what}?`, { title: 'Delete booking' })) return;
    
    try {
        await deleteBookingApi(id);
        
        state.bookings = state.bookings.filter(b => b.id !== id);
        invalidateBookingsCache();
        
        renderCalendar();
        if (state.selectedDate) {
            renderDayBookings(state.selectedDate);
            updateAvailableSpotsHint(state.selectedDate);
        }
        window.updateCapacityDisplay?.();
        
        showToast('Booking deleted');
    } catch (error) {
        showToast('Failed to delete booking', 'error');
    }
}

/**
 * Handle team selection change
 */
export function handleTeamSelect() {
    const teamId = elements.teamSelect?.value;
    const teamInfo = document.getElementById('bookingTeamInfo');
    
    if (teamId && teamInfo) {
        const team = state.teams.find(t => t.id === teamId);
        if (team) {
            teamInfo.textContent = `${team.memberCount} team members • Manager: ${team.manager || 'Not assigned'}`;
        } else {
            teamInfo.textContent = '';
        }
    } else if (teamInfo) {
        teamInfo.textContent = '';
    }
    
    checkOverbooking();
}

// Export for global access
export { isOverbooking };

