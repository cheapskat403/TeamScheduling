/**
 * Utility Functions
 * Common helper functions used across the application
 */

import { UI_CONFIG } from './config.js';
import { formatLocalDate, formatDisplayDate as formatDisplayDateUtil, parseLocalDate } from './date-utils.js';

/**
 * Format a Date object to YYYY-MM-DD string
 * Uses timezone-aware formatting to avoid UTC conversion issues
 */
export function formatDateStr(date) {
    return formatLocalDate(date);
}

/**
 * Format date for display (e.g., "Monday, January 15, 2024")
 * Uses timezone-aware parsing to avoid UTC conversion issues
 */
export function formatDisplayDate(dateStr) {
    return formatDisplayDateUtil(dateStr);
}

/**
 * Show a toast notification
 */
export function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    // Accessibility: announce to screen readers
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after configured duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), UI_CONFIG.animationDuration);
    }, UI_CONFIG.toastDuration);
}

/**
 * Get initials from a name
 */
export function getInitials(name) {
    if (!name) return '?';
    return name.split(' ')
        .filter(n => n.length > 0)
        .map(n => n[0].toUpperCase())
        .slice(0, 2)
        .join('');
}

/**
 * Generate avatar HTML (image or initials)
 */
export function getAvatarHTML(managerName, imageUrl, color, className = '') {
    const safeName = escapeHtml(managerName || '');
    const bg = safeColor(color, '#6B7280');
    const src = safeImageSrc(imageUrl);
    if (src) {
        return `<img src="${escapeHtml(src)}" alt="${safeName}" class="${className}" loading="lazy">`;
    }
    const initials = getInitials(managerName);
    return `<div class="${className}" style="background: ${bg}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">${escapeHtml(initials)}</div>`;
}

/**
 * Adjust color brightness
 */
export function adjustColor(color, amount) {
    const clamp = (num) => Math.min(255, Math.max(0, num));
    let hex = safeColor(color, '#6B7280').replace('#', '');
    if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) hex = hex.length === 3 || hex.length === 4 ? hex.split('').map(c => c + c).join('') : '6B7280';
    const r = clamp(parseInt(hex.substr(0, 2), 16) + amount);
    const g = clamp(parseInt(hex.substr(2, 2), 16) + amount);
    const b = clamp(parseInt(hex.substr(4, 2), 16) + amount);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Generate a consistent color from a string
 */
export function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** A picture link we are willing to show: an image data URL, an https link or one of our own /paths. Otherwise ''. */
export function safeImageSrc(value) {
    if (typeof value !== 'string') return '';
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
    if (/^https:\/\/[^\s"'<>\\`]+$/.test(value)) return value;
    if (/^\/(?!\/)[A-Za-z0-9._/-]+$/.test(value)) return value;
    return '';
}

/** A hex colour such as #3b82f6, or the fallback. Use for any colour that ends up in a style or attribute. */
export function safeColor(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
    if (/^hsl\(-?\d{1,3}, \d{1,3}%, \d{1,3}%\)$/.test(value)) return value;   // what stringToColor() makes
    return fallback;
}

/**
 * Get effective people count for a booking
 * Uses current team memberCount if available
 */
export function getBookingPeopleCount(booking, teams) {
    const team = teams.find(t => t.id === booking.teamId);
    return team ? team.memberCount : booking.peopleCount;
}

