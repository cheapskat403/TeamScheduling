/**
 * Calendar Rendering
 * Handles the calendar grid display and navigation
 */

import { state, elements } from './state.js';
import { formatDateStr, getBookingPeopleCount, getInitials, getAvatarHTML, escapeHtml, safeColor, safeImageSrc } from './utils.js';
import { loadBookingsForMonth } from './api.js';
import { joinCurrentRoom } from './socket.js';
import { canBookCalendar } from './permissions.js';

// Navigation state to prevent rapid clicking
let isNavigating = false;

/**
 * Render the calendar view
 */
export function renderCalendar(isLoading = false) {
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    const today = new Date();
    
    // Update month display
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    if (elements.currentMonth) {
        elements.currentMonth.textContent = `${monthNames[month]} ${year}`;
    }
    
    // Get bookings for this month
    const monthBookings = state.bookings.filter(b => {
        const bookingDate = new Date(b.date);
        return bookingDate.getFullYear() === year && bookingDate.getMonth() === month;
    });
    
    // Get current location capacity
    const location = state.locations.find(l => l.id === state.currentLocation);
    const capacity = location ? location.capacity : 21;
    
    // Check if mobile
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        renderCalendarList(year, month, monthBookings, capacity, today, isLoading);
    } else {
        renderCalendarGrid(year, month, monthBookings, capacity, today, isLoading);
    }
}

/**
 * Render the calendar as a grid (desktop view)
 */
function renderCalendarGrid(year, month, monthBookings, capacity, today, isLoading) {
    const grid = elements.calendarGrid;
    if (!grid) return;
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDay = firstDay.getDay();
    const totalDays = lastDay.getDate();
    
    let html = '';
    
    // Empty cells for days before the first day of the month
    // Note: Week starts on Monday (index 0=Mon, 6=Sun)
    // Adjust startingDay: JS Date.getDay() returns 0=Sun, we need 0=Mon
    const adjustedStartDay = startingDay === 0 ? 6 : startingDay - 1;
    for (let i = 0; i < adjustedStartDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    // Days of the month
    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateStr(date);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = date.toDateString() === today.toDateString();
        const holiday = state.publicHolidays.find(h => h.date === dateStr);
        const dayBookings = monthBookings.filter(b => b.date === dateStr);
        const totalPeople = dayBookings.reduce((sum, b) => sum + getBookingPeopleCount(b, state.teams), 0);
        
        let classes = ['calendar-day'];
        if (isWeekend) classes.push('weekend');
        if (isToday) classes.push('today');
        if (holiday) classes.push('holiday');
        
        let dayContent = `<span class="day-number">${day}</span>`;
        
        // Capacity indicator
        if (!isWeekend && !holiday && totalPeople > 0) {
            let capacityClass = '';
            if (totalPeople >= capacity) capacityClass = 'full';
            else if (totalPeople >= capacity * 0.8) capacityClass = 'warning';
            dayContent += `<span class="day-capacity ${capacityClass}">${totalPeople}/${capacity}</span>`;
        }
        
        // Holiday label
        if (holiday) {
            dayContent += `<span class="holiday-label">${escapeHtml(holiday.name)}</span>`;
        }
        
        // Booking chips with drag & drop (sorted by team name)
        if (!isWeekend && !holiday && dayBookings.length > 0) {
            dayContent += '<div class="day-bookings-preview">';
            const maxShow = 5;
            const sortedDayBookings = [...dayBookings].sort((a, b) => {
                const teamA = state.teams.find(t => t.id === a.teamId);
                const teamB = state.teams.find(t => t.id === b.teamId);
                const nameA = teamA ? teamA.name : a.teamName || '';
                const nameB = teamB ? teamB.name : b.teamName || '';
                return nameA.localeCompare(nameB);
            });
            
            sortedDayBookings.slice(0, maxShow).forEach(booking => {
                const team = state.teams.find(t => t.id === booking.teamId);
                const color = team ? team.color : '#6B7280';
                const displayName = team ? team.name : booking.teamName;
                const isOverbooked = booking.notes && booking.notes.startsWith('[OVERBOOKED]');
                const isLoadingBooking = booking._isLoading;
                
                dayContent += `
                    <div class="booking-chip ${isOverbooked ? 'overbooked' : ''} ${isLoadingBooking ? 'loading' : ''}" 
                         style="background: ${safeColor(color, '#6B7280')}" 
                         draggable="${!isLoadingBooking && canBookCalendar()}"
                         ondragstart="handleDragStart(event, '${escapeHtml(booking.id)}')"
                         ondragend="handleDragEnd(event)"
                         onmouseenter="showTeamTooltip(event, '${escapeHtml(booking.teamId)}')"
                         onmouseleave="hideTeamTooltip()">
                        <span>${escapeHtml(displayName)}</span>
                        ${isOverbooked ? '<span class="overbooked-icon" title="Overbooked">⚠️</span>' : ''}
                        ${isLoadingBooking ? '<span class="chip-spinner"></span>' : ''}
                    </div>`;
            });
            
            if (dayBookings.length > maxShow) {
                dayContent += `<div class="booking-chip more">+${dayBookings.length - maxShow}</div>`;
            }
            dayContent += '</div>';
        }
        
        // Loading skeleton
        if (isLoading && !isWeekend && !holiday) {
            dayContent += '<div class="booking-loading-skeleton"></div>';
        }
        
        const dropHandlers = !isWeekend && !holiday && canBookCalendar() ? 
            `ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${dateStr}')"` : '';
        
        html += `<div class="${classes.join(' ')}" onclick="openBookingModal('${dateStr}')" ${dropHandlers}>${dayContent}</div>`;
    }
    
    // Remove skeleton class and set content
    grid.classList.remove('calendar-skeleton');
    grid.innerHTML = html;
}

/**
 * Render the calendar as a list (mobile view)
 */
function renderCalendarList(year, month, monthBookings, capacity, today, isLoading) {
    const listContainer = document.getElementById('calendarList');
    if (!listContainer) {
        console.error('Mobile list container #calendarList not found');
        return;
    }
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const todayStr = formatDateStr(today);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    let listHtml = '';
    
    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateStr(date);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isToday = dateStr === todayStr;
        const holiday = state.publicHolidays.find(h => h.date === dateStr);
        
        // Skip weekends in mobile list view
        if (isWeekend) continue;
        
        const dayBookings = monthBookings.filter(b => b.date === dateStr);
        const totalPeople = dayBookings.reduce((sum, b) => sum + getBookingPeopleCount(b, state.teams), 0);
        
        let classes = ['calendar-list-day'];
        if (isToday) classes.push('today');
        if (holiday) classes.push('holiday');
        
        // Capacity class
        let capacityClass = '';
        if (totalPeople >= capacity) capacityClass = 'full';
        else if (totalPeople >= capacity * 0.8) capacityClass = 'warning';
        
        // Bookings HTML
        let bookingsHtml = '';
        if (isLoading && !holiday) {
            bookingsHtml = `<div class="calendar-list-loading-skeleton"></div>`;
        } else if (holiday) {
            bookingsHtml = `<div class="calendar-list-holiday">${escapeHtml(holiday.name)}</div>`;
        } else if (dayBookings.length > 0) {
            const sortedBookings = [...dayBookings].sort((a, b) => {
                const teamA = state.teams.find(t => t.id === a.teamId);
                const teamB = state.teams.find(t => t.id === b.teamId);
                return (teamA?.name || '').localeCompare(teamB?.name || '');
            });
            
            bookingsHtml = '<div class="calendar-list-bookings">';
            sortedBookings.forEach(booking => {
                const team = state.teams.find(t => t.id === booking.teamId);
                const color = team ? team.color : '#6B7280';
                const displayName = team ? team.name : booking.teamName;
                const displayCount = team ? team.memberCount : booking.peopleCount;
                const managerImage = team?.managerImage;
                const managerName = team?.manager || '';
                
                // Avatar HTML
                let avatarHtml = '';
                if (safeImageSrc(managerImage)) {
                    avatarHtml = `<img src="${escapeHtml(safeImageSrc(managerImage))}" alt="${escapeHtml(managerName)}" class="calendar-list-booking-avatar" loading="lazy">`;
                } else {
                    const initials = getInitials(managerName);
                    avatarHtml = `<div class="calendar-list-booking-avatar" style="background: ${safeColor(color, '#6B7280')}">${escapeHtml(initials)}</div>`;
                }
                
                bookingsHtml += `
                    <div class="calendar-list-booking" onclick="openBookingModal('${dateStr}')">
                        ${avatarHtml}
                        <div class="calendar-list-booking-color" style="background: ${safeColor(color, '#6B7280')}"></div>
                        <div class="calendar-list-booking-info">
                            <span class="calendar-list-booking-team">${escapeHtml(displayName)}</span>
                            <span class="calendar-list-booking-count">${displayCount} people</span>
                        </div>
                    </div>
                `;
            });
            bookingsHtml += '</div>';
        } else {
            bookingsHtml = `<div class="calendar-list-empty" onclick="openBookingModal('${dateStr}')">No bookings - tap to add</div>`;
        }
        
        listHtml += `
            <div class="${classes.join(' ')}">
                <div class="calendar-list-header" onclick="openBookingModal('${dateStr}')">
                    <div class="calendar-list-date">
                        <span class="calendar-list-day-num">${day}</span>
                        <span class="calendar-list-day-name">${dayNames[dayOfWeek]}</span>
                    </div>
                    <div class="calendar-list-meta">
                        ${!holiday ? `<span class="calendar-list-capacity ${capacityClass}">${totalPeople}/${capacity}</span>` : ''}
                    </div>
                </div>
                ${bookingsHtml}
            </div>
        `;
    }
    
    listContainer.innerHTML = listHtml;
}

/**
 * Render skeleton calendar for loading state
 */
export function renderSkeletonCalendar() {
    const grid = elements.calendarGrid;
    if (!grid) return;
    
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    
    // Update month display
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    if (elements.currentMonth) {
        elements.currentMonth.textContent = `${monthNames[month]} ${year}`;
    }
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDay = firstDay.getDay();
    const totalDays = lastDay.getDate();
    
    let html = '';
    
    // Empty cells for days before the first day of the month
    const adjustedStartDay = startingDay === 0 ? 6 : startingDay - 1;
    for (let i = 0; i < adjustedStartDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    // Skeleton days
    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        
        let classes = ['calendar-day', 'skeleton'];
        if (isWeekend) classes.push('weekend');
        
        html += `<div class="${classes.join(' ')}"></div>`;
    }
    
    grid.innerHTML = html;
}

/**
 * Navigate to previous/next month
 */
export async function navigateMonth(delta) {
    if (isNavigating) return;
    isNavigating = true;
    
    const grid = elements.calendarGrid;
    // When going to next month (delta > 0): old slides left, new comes from right
    // When going to prev month (delta < 0): old slides right, new comes from left
    const outClass = delta > 0 ? 'slide-out-left' : 'slide-out-right';
    const inClass = delta > 0 ? 'slide-in-left' : 'slide-in-right';
    
    // Remove any existing animation classes
    grid?.classList.remove('slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right');
    
    // Slide out current content
    grid?.classList.add(outClass);
    
    // Wait for slide-out animation
    await new Promise(resolve => setTimeout(resolve, 120));
    
    // Update month while content is off-screen
    state.currentDate.setMonth(state.currentDate.getMonth() + delta);
    
    // Show skeleton loader
    grid?.classList.add('calendar-skeleton');
    renderSkeletonCalendar();
    
    // Switch from out to in animation
    grid?.classList.remove(outClass);
    grid?.classList.add(inClass);
    
    // Join new room and load bookings in parallel
    joinCurrentRoom();
    loadBookingsForMonth().then(() => {
        renderCalendar(false);
        window.updateCapacityDisplay?.();
    });
    
    // Wait for slide-in animation
    await new Promise(resolve => setTimeout(resolve, 120));
    
    // Clean up animation class
    grid?.classList.remove(inClass);
    
    isNavigating = false;
}

/**
 * Go to today's date
 */
export async function goToToday() {
    const grid = elements.calendarGrid;
    
    state.currentDate = new Date();
    
    // Show skeleton loader
    grid?.classList.add('calendar-skeleton');
    renderSkeletonCalendar();
    
    joinCurrentRoom();
    await loadBookingsForMonth();
    renderCalendar(false);
    window.updateCapacityDisplay?.();
}

