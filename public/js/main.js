/**
 * Office Booking System - Main Entry Point
 * 
 * This module initializes the application and sets up global event handlers.
 * Uses ES6 modules for better code organization and maintainability.
 */

// Import all modules
import { state, elements, initElements } from './state.js';
import { loadTheme, toggleTheme } from './theme.js';
import { initSocket, joinCurrentRoom, simulateNewUser } from './socket.js';
import { loadData, loadBookingsForMonth, invalidateBookingsCache } from './api.js';
import { renderCalendar, navigateMonth, goToToday, renderSkeletonCalendar } from './calendar.js';
import { 
    openBookingModal, closeModal, handleBookingSubmit, 
    editBooking, deleteBooking, handleTeamSelect, renderDayBookings,
    updateAvailableSpotsHint, checkOverbooking
} from './bookings.js';
import { 
    renderTeamSelect, renderTeamsList, renderTeamLocationSelect,
    handleTeamSubmit, editTeam, deleteTeam, closeTeamModal, clearSelectedManager,
    showTeamTooltip, hideTeamTooltip, openTeamModal
} from './teams.js';
import { 
    renderLocationSelect, renderLocationsList, 
    handleLocationSubmit, editLocation, deleteLocation, closeLocationModal, openLocationModal,
    updateCapacityDisplay
} from './locations.js';
import { 
    renderHolidayYearSelect, renderHolidaysList, 
    fetchHolidays, deleteHoliday 
} from './holidays.js';
import { 
    handleDragStart, handleDragEnd, handleDragOver, 
    handleDragLeave, handleDrop 
} from './dragdrop.js';
import { addToOutlookCalendar, downloadICS } from './calendar-sync.js';
import { switchView, setupSettingsSubmenu, toggleMobileMenu, closeMobileMenu, savedView, viewFromHash } from './views.js';
import { 
    initTeamRolesView, toggleTeamRole, openManagerSelector, 
    closeManagerDropdown, selectManager 
} from './azure-managers.js';
import { formatDateStr, showToast } from './utils.js';

/**
 * Initialize the application
 * Called after authentication is complete
 */
async function initApp() {
    console.log('🏢 Initializing Office Booking System...');
    
    // Initialize DOM element references
    initElements();
    
    // Load theme
    loadTheme();
    
    // Load initial data
    await loadData();
    await loadBookingsForMonth();
    
    // Setup event listeners
    setupEventListeners();
    
    // Initial render
    renderCalendar();
    renderLocationSelect();
    renderTeamSelect();
    updateCapacityDisplay();
    
    // Initialize Socket.IO
    initSocket();

    // Return to the page we were on before a refresh
    const startView = savedView();
    if (startView && startView !== 'calendar') {
        await switchView(startView, { updateUrl: false });
    }
    
    console.log('✅ Application initialized');
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Navigation - items with data-view attribute
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });
    
    // Logo click - navigate to calendar
    document.querySelectorAll('.logo-clickable').forEach(logo => {
        logo.addEventListener('click', (e) => {
            if (e.target.closest('.theme-toggle')) return;
            switchView('calendar');
            closeMobileMenu(); // Close mobile menu if open
        });
    });
    
    // Settings submenu toggle
    setupSettingsSubmenu();
    
    // Month navigation
    document.getElementById('prevMonth')?.addEventListener('click', () => navigateMonth(-1));
    document.getElementById('nextMonth')?.addEventListener('click', () => navigateMonth(1));
    document.getElementById('todayBtn')?.addEventListener('click', goToToday);
    
    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboardNav);
    
    // Theme toggle
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    document.getElementById('mobileThemeToggle')?.addEventListener('click', toggleTheme);

    // Browser back / forward between pages
    window.addEventListener('popstate', () => {
        switchView(viewFromHash() || 'calendar', { updateUrl: false });
    });
    
    // Location change
    elements.locationSelect?.addEventListener('change', handleLocationChange);
    
    // Booking form
    elements.bookingForm?.addEventListener('submit', handleBookingSubmit);
    elements.teamSelect?.addEventListener('change', handleTeamSelect);
    
    // Team form
    elements.teamForm?.addEventListener('submit', handleTeamSubmit);
    
    // Location form
    elements.locationForm?.addEventListener('submit', handleLocationSubmit);
    
    // Add Team button
    document.getElementById('addTeamBtn')?.addEventListener('click', openTeamModal);
    
    // Add Location button
    document.getElementById('addLocationBtn')?.addEventListener('click', openLocationModal);
    
    // Holiday year select
    document.getElementById('holidayYearSelect')?.addEventListener('change', renderHolidaysList);
    document.getElementById('fetchHolidaysBtn')?.addEventListener('click', fetchHolidays);
    
    // Mobile menu
    document.getElementById('mobileMenuBtn')?.addEventListener('click', toggleMobileMenu);
    document.querySelector('.mobile-overlay')?.addEventListener('click', closeMobileMenu);
    
    // Azure AD manager selector
    document.getElementById('selectManagerBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openManagerSelector();
    });
    
    // Team Roles refresh button
    document.getElementById('refreshRolesBtn')?.addEventListener('click', () => {
        initTeamRolesView();
    });
    
    // Modal close on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
    
    // Window resize handler
    window.addEventListener('resize', debounce(() => {
        renderCalendar();
    }, 250));
}

/**
 * Handle keyboard navigation
 */
function handleKeyboardNav(e) {
    // Only handle if not in an input or textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    
    // Only handle on calendar view
    const calendarView = document.getElementById('calendarView');
    if (!calendarView?.classList.contains('active')) return;
    
    switch (e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            navigateMonth(-1);
            break;
        case 'ArrowRight':
            e.preventDefault();
            navigateMonth(1);
            break;
        case 't':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                goToToday();
            }
            break;
        case 'Escape':
            closeModal();
            closeTeamModal();
            closeLocationModal();
            closeManagerDropdown();
            break;
    }
}

/**
 * Handle location change
 */
async function handleLocationChange(e) {
    state.currentLocation = e.target.value;
    state.bookings = []; // Clear bookings to show loading state
    
    // Show skeleton loader
    elements.calendarGrid?.classList.add('calendar-skeleton');
    renderSkeletonCalendar();
    
    updateCapacityDisplay();
    renderTeamSelect();
    joinCurrentRoom();
    
    // Load bookings in background and re-render when done
    await loadBookingsForMonth();
    renderCalendar();
    updateCapacityDisplay();
    
    // Reload desks if desks view is active
    if (document.getElementById('desksView')?.classList.contains('active')) {
        if (typeof window.updateFloorSelector === 'function') {
            window.updateFloorSelector();
        }
        if (typeof window.loadDesks === 'function') {
            window.loadDesks();
        }
    }
}

/**
 * Simple debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================
// Expose functions globally for HTML onclick handlers
// ============================================

// Calendar & Navigation
window.renderCalendar = renderCalendar;
window.navigateMonth = navigateMonth;
window.goToToday = goToToday;

// Bookings
window.openBookingModal = openBookingModal;
window.closeModal = closeModal;
window.editBooking = editBooking;
window.deleteBooking = deleteBooking;

// Drag & Drop
window.handleDragStart = handleDragStart;
window.handleDragEnd = handleDragEnd;
window.handleDragOver = handleDragOver;
window.handleDragLeave = handleDragLeave;
window.handleDrop = handleDrop;

// Teams
window.editTeam = editTeam;
window.deleteTeam = deleteTeam;
window.closeTeamModal = closeTeamModal;
window.clearSelectedManager = clearSelectedManager;
window.showTeamTooltip = showTeamTooltip;
window.hideTeamTooltip = hideTeamTooltip;

// Locations
window.editLocation = editLocation;
window.deleteLocation = deleteLocation;
window.closeLocationModal = closeLocationModal;
window.openLocationModal = openLocationModal;
window.updateCapacityDisplay = updateCapacityDisplay;

// Teams - modal
window.openTeamModal = openTeamModal;

// Holidays
window.deleteHoliday = deleteHoliday;

// Calendar Sync
window.addToOutlookCalendar = addToOutlookCalendar;
window.downloadICS = downloadICS;

// Views
window.switchView = switchView;

// Azure AD
window.initTeamRolesView = initTeamRolesView;
window.toggleTeamRole = toggleTeamRole;
window.openManagerSelector = openManagerSelector;
window.selectManager = selectManager;

// Theme
window.toggleTheme = toggleTheme;

// Testing/Development
window.simulateNewUser = simulateNewUser;

// Export initApp for auth.js to call
window.initApp = initApp;

// ============================================
// Expose globals needed by floor-plan.js
// (floor-plan.js is loaded dynamically and uses global scope)
// ============================================
window.state = state;
window.formatDateStr = formatDateStr;
window.showToast = showToast;

console.log('📦 Modules loaded successfully');

