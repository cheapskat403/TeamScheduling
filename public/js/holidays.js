/**
 * Holiday Management
 * Handles fetching, displaying, and managing public holidays
 */

import { state } from './state.js';
import { showToast, escapeHtml } from './utils.js';
import { fetchHolidaysFromApi, saveHolidays, deleteHolidayApi } from './api.js';
import { renderCalendar } from './calendar.js';
import { askConfirm } from './confirm.js';

/**
 * Render the holiday year selector
 */
export function renderHolidayYearSelect() {
    const select = document.getElementById('holidayYearSelect');
    if (!select) return;
    
    const currentYear = new Date().getFullYear();
    // Show current year plus 3 years into the future
    const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];
    
    select.innerHTML = years.map(year => 
        `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`
    ).join('');
    
    // Ensure the value is set (some browsers don't immediately update after innerHTML)
    select.value = String(currentYear);
}

/**
 * Render the holidays list
 */
export function renderHolidaysList() {
    const container = document.getElementById('holidaysList');
    if (!container) return;
    
    // Get selected year
    const yearSelect = document.getElementById('holidayYearSelect');
    const selectedYear = yearSelect?.value ? parseInt(yearSelect.value) : new Date().getFullYear();
    
    // Filter holidays for selected year
    const yearHolidays = (state.publicHolidays || [])
        .filter(h => h.date && h.date.startsWith(String(selectedYear)))
        .sort((a, b) => a.date.localeCompare(b.date));
    
    if (yearHolidays.length === 0) {
        container.innerHTML = `
            <p class="no-data">No holidays for ${selectedYear}</p>
            <p class="hint">Click "Fetch Holidays" to load public holidays from the API.</p>
        `;
        return;
    }
    
    container.innerHTML = yearHolidays.map(holiday => {
        const date = new Date(holiday.date + 'T00:00:00');
        const formatted = date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
        
        return `
            <div class="holiday-item">
                <div class="holiday-info">
                    <span class="holiday-date">${formatted}</span>
                    <span class="holiday-name">${escapeHtml(holiday.name)}</span>
                </div>
                <button class="btn-icon danger" onclick="deleteHoliday('${escapeHtml(holiday.date)}')" title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Fetch holidays from external API and save to database
 */
export async function fetchHolidays() {
    const yearSelect = document.getElementById('holidayYearSelect');
    const year = yearSelect ? yearSelect.value : new Date().getFullYear();
    
    const btn = document.getElementById('fetchHolidaysBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Fetching...';
    }
    
    try {
        // Fetch from external API
        const holidays = await fetchHolidaysFromApi(year);
        
        // Save to database
        const saved = await saveHolidays(holidays);
        
        // Update state
        state.publicHolidays = saved;
        
        // Re-render
        renderHolidaysList();
        renderCalendar();
        
        showToast(`Loaded ${holidays.length} holidays for ${year}`);
        
    } catch (error) {
        console.error('Error fetching holidays:', error);
        showToast('Failed to fetch holidays', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Fetch Holidays';
        }
    }
}

/**
 * Delete a holiday
 */
export async function deleteHoliday(date) {
    const holiday = state.publicHolidays.find(h => h.date === date);
    const what = holiday ? `"${holiday.name}" (${holiday.date})` : 'this holiday';
    if (!await askConfirm(`Delete ${what}?`, { title: 'Delete holiday' })) return;
    
    try {
        await deleteHolidayApi(date);
        
        state.publicHolidays = state.publicHolidays.filter(h => h.date !== date);
        
        renderHolidaysList();
        renderCalendar();
        
        showToast('Holiday deleted');
    } catch (error) {
        showToast('Failed to delete holiday', 'error');
    }
}

