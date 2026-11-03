/**
 * View Switching
 * Handles navigation between different views (calendar, teams, settings, etc.)
 */

import { renderTeamsList, renderTeamLocationSelect } from './teams.js';
import { renderLocationsList } from './locations.js';
import { renderHolidaysList, renderHolidayYearSelect } from './holidays.js';
import { cleanupView } from './event-manager.js';
import { canOpenView } from './permissions.js';
import { initAuditView } from './audit.js';
import { initAccessView } from './access.js';

// Floor plan module loading state
let floorPlanModuleLoading = false;
let floorPlanModuleLoaded = false;

// Pages that were merged into another, so old bookmarks and remembered pages still land somewhere sensible
const LEGACY_VIEWS = { teamRoles: 'access' };

// Track current view for cleanup
let currentView = 'calendar';

/**
 * Switch to a different view
 */
export async function switchView(viewName, { updateUrl = true } = {}) {
    viewName = LEGACY_VIEWS[viewName] || viewName;

    // Pages only some people may open (the server refuses their data as well)
    if (!canOpenView(viewName)) {
        viewName = 'calendar';
        updateUrl = false;
    }

    // Cleanup event listeners from previous view
    if (currentView && currentView !== viewName) {
        cleanupView(currentView);
    }
    
    // Update current view
    currentView = viewName;
    
    // Hide all views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    // Show selected view
    const targetView = document.getElementById(`${viewName}View`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });
    
    // Remember where we are, so a refresh (or the back button) returns to this page
    try { sessionStorage.setItem('currentView', viewName); } catch (e) { /* storage unavailable */ }
    if (updateUrl && location.hash !== `#${viewName}`) {
        history.pushState({ view: viewName }, '', `#${viewName}`);
    }
    revealNavItem(viewName);

    // Close mobile menu
    closeMobileMenu();

    // View-specific initialization
    switch (viewName) {
        case 'calendar':
            window.renderCalendar?.();
            break;
            
        case 'teams':
            renderTeamsList();
            renderTeamLocationSelect();
            break;
            
        case 'locations':
            renderLocationsList();
            break;
            
        case 'holidays':
            renderHolidayYearSelect();
            renderHolidaysList();
            break;
            
        case 'desks':
            await loadFloorPlanModule();
            break;
            
        case 'audit':
            initAuditView();
            break;

        case 'access':
            initAccessView();
            break;
    }
}

/**
 * Load floor plan module lazily
 */
async function loadFloorPlanModule() {
    if (floorPlanModuleLoaded || floorPlanModuleLoading) {
        // Module already loaded, just initialize
        if (typeof window.initDesksView === 'function') {
            window.initDesksView();
        }
        return;
    }
    
    floorPlanModuleLoading = true;
    
    try {
        // Dynamically load the floor plan script
        await new Promise((resolve, reject) => {
            // Remove any existing script to force reload
            const existing = document.querySelector('script[src^="floor-plan.js"]');
            if (existing) {
                existing.remove();
            }
            
            const script = document.createElement('script');
            // Add cache-busting timestamp to force fresh download
            script.src = `floor-plan.js?v=${Date.now()}`;
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
        });
        
        floorPlanModuleLoaded = true;
        
        // Initialize after load
        if (typeof window.initDesksView === 'function') {
            window.initDesksView();
        }
        
    } catch (error) {
        console.error('Failed to load floor plan module:', error);
    } finally {
        floorPlanModuleLoading = false;
    }
}

/**
 * Setup settings submenu toggle
 */
/** The view named in the URL hash, if there is one and it exists */
export function viewFromHash() {
    let name = '';
    try { name = decodeURIComponent(location.hash.replace(/^#\/?/, '')); } catch (e) { return null; }
    name = LEGACY_VIEWS[name] || name;
    return name && document.getElementById(`${name}View`)?.classList.contains('view') ? name : null;
}

/** The page to open on load: the URL's, else the one this tab was last on */
export function savedView() {
    const fromHash = viewFromHash();
    if (fromHash) return fromHash;
    try {
        const stored = sessionStorage.getItem('currentView');
        const name = LEGACY_VIEWS[stored] || stored;
        return name && document.getElementById(`${name}View`)?.classList.contains('view') ? name : null;
    } catch (e) {
        return null;
    }
}

/** Pages inside the Settings submenu need it open to show which one is active */
function revealNavItem(viewName) {
    const item = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (!item || !item.closest('#settingsSubmenu')) return;
    document.getElementById('settingsSubmenu')?.classList.add('open');
    document.getElementById('settingsToggle')?.classList.add('expanded');
}

export function setupSettingsSubmenu() {
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsSubmenu = document.getElementById('settingsSubmenu');
    
    if (!settingsToggle || !settingsSubmenu) {
        console.warn('Settings submenu elements not found, retrying...');
        setTimeout(setupSettingsSubmenu, 100);
        return;
    }
    
    // Remove any existing listeners by cloning
    const newToggle = settingsToggle.cloneNode(true);
    settingsToggle.parentNode.replaceChild(newToggle, settingsToggle);
    
    newToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        newToggle.classList.toggle('expanded');
        settingsSubmenu.classList.toggle('open');
    });
}

/**
 * Close mobile menu
 */
export function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-overlay');
    
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

/**
 * Toggle mobile menu
 */
export function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-overlay');
    
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

