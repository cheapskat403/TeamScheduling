/**
 * Socket.IO Real-Time Communication
 * Handles presence tracking and live updates
 */

import { state } from './state.js';
import { stringToColor, escapeHtml } from './utils.js';

let socket = null;
let previousViewerIds = new Set(); // Track previous viewers for animation
let viewersJustRemoved = false; // Track if viewers were just removed for reverse bump

/**
 * Initialize Socket.IO connection
 */
export function initSocket() {
    // Get user name - check Azure AD first, then localStorage, then generate
    let userName = null;
    let userId = null;
    let userPhoto = null;
    
    // Check for Azure AD authenticated user (set by auth.js)
    if (window.currentUser) {
        userName = window.currentUser.name || window.currentUser.email || 'Anonymous';
        userId = window.currentUser.id || window.currentUser.email;
        userPhoto = window.currentUser.photo || null;
        // Store photo in localStorage for persistence
        if (userPhoto) {
            localStorage.setItem('employeePhoto', userPhoto);
        }
    } else {
        // Check localStorage for employee name (set by Azure AD auth)
        const employeeName = localStorage.getItem('employeeName');
        const employeeEmail = localStorage.getItem('employeeEmail');
        if (employeeName || employeeEmail) {
            userName = employeeName || employeeEmail || 'Anonymous';
            userId = employeeEmail || localStorage.getItem('myUserId');
            userPhoto = localStorage.getItem('employeePhoto') || null;
        } else {
            // Fall back to old localStorage keys
            userName = localStorage.getItem('userName');
            if (!userName) {
                // Check if Azure AD user (legacy format)
                const azureUser = localStorage.getItem('azureAdUser');
                if (azureUser) {
                    try {
                        const user = JSON.parse(azureUser);
                        userName = user.name || user.email || 'Anonymous';
                        userId = user.id || user.email;
                    } catch (e) {
                        userName = 'User-' + Math.random().toString(36).substring(2, 6);
                    }
                } else {
                    userName = 'User-' + Math.random().toString(36).substring(2, 6);
                }
                localStorage.setItem('userName', userName);
            }
        }
    }
    
    // Set user ID - use Azure AD ID if available, otherwise check localStorage or generate
    if (!userId) {
        userId = localStorage.getItem('myUserId');
        if (!userId) {
            userId = 'user-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
            localStorage.setItem('myUserId', userId);
        }
    } else {
        // Store Azure AD user ID for consistency
        localStorage.setItem('myUserId', userId);
    }
    
    state.myName = userName;
    state.myUserId = userId;
    state.myPhoto = userPhoto; // Store photo for presence display
    
    console.log('Socket initialization:', { userName, userId, hasPhoto: !!userPhoto });

    // Initialize Socket.IO
    if (typeof io !== 'undefined') {
        // The server only accepts websockets with a valid login. This function runs on every connect and
        // reconnect, so the token is always fresh.
        socket = io({
            auth: (cb) => {
                const getToken = window.getIdTokenQuietly || (async () => null);
                getToken().then(token => cb({ token })).catch(() => cb({}));
            }
        });

        let authRetries = 0;

        socket.on('connect', () => {
            authRetries = 0;
            console.log('Socket connected for user:', userName);
            joinCurrentRoom();
        });

        // A refused login is not retried automatically by Socket.IO: try again a few times with a fresh token
        socket.on('connect_error', (err) => {
            if (/^AUTH_/.test(err.message) && authRetries < 5) {
                authRetries++;
                setTimeout(() => socket.connect(), 3000 * authRetries);
            }
        });

        socket.on('presence:update', ({ roomKey, viewers }) => {
            // Include all viewers (including current user)
            state.viewers = viewers;
            renderViewers();
        });

        socket.on('data:changed', (payload) => {
            handleDataChange(payload);
        });
    }
}

/**
 * Join the current room based on location and month
 */
export function joinCurrentRoom() {
    if (!socket || !socket.connected) {
        console.warn('Cannot join room: socket not connected');
        return;
    }
    
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    const locationId = state.currentLocation;
    const roomKey = `presence:${locationId}:${year}-${String(month + 1).padStart(2, '0')}`;
    
    if (roomKey === state.currentRoom) {
        console.log('Already in room:', roomKey);
        return;
    }
    
    console.log('Joining room:', roomKey, 'as user:', state.myName);
    state.currentRoom = roomKey;
    
    // Add current user to viewers list immediately (will be updated by server)
    const currentUser = {
        id: state.myUserId,
        name: state.myName,
        color: stringToColor(state.myUserId),
        photo: state.myPhoto || null
    };
    
    // Update local state to include current user
    if (!state.viewers.find(v => v.id === state.myUserId)) {
        state.viewers.push(currentUser);
        renderViewers();
    }
    
    socket.emit('presence:join', {
        roomKey,
        user: currentUser
    });
}

/**
 * Render presence indicators (viewers)
 */
export function renderViewers() {
    const container = document.getElementById('presenceAvatars');
    const countElement = document.getElementById('presenceCount');
    if (!container) return;
    
    // Ensure current user is included in the viewers list
    const allViewers = [...state.viewers];
    const currentUserInList = allViewers.find(v => v.id === state.myUserId);
    
    // Add current user if not already in the list
    if (!currentUserInList && state.myUserId && state.myName) {
        allViewers.push({
            id: state.myUserId,
            name: state.myName,
            color: stringToColor(state.myUserId),
            photo: state.myPhoto || null
        });
    }
    
    const currentRoomViewers = allViewers;
    const totalViewers = currentRoomViewers.length;
    const maxShow = 3;
    const shown = currentRoomViewers.slice(0, maxShow);
    const overflow = totalViewers - maxShow;
    
    // Update count
    if (countElement) {
        countElement.textContent = totalViewers === 0 ? '' : totalViewers;
    }
    
    if (totalViewers === 0) {
        container.innerHTML = '';
        return;
    }
    
    // Detect new and removed viewers for animation
    const currentViewerIds = new Set(currentRoomViewers.map(v => v.id));
    const newViewerIds = new Set();
    const removedViewerIds = new Set();
    
    // Find new viewers
    currentViewerIds.forEach(id => {
        if (!previousViewerIds.has(id)) {
            newViewerIds.add(id);
        }
    });
    
    // Find removed viewers
    previousViewerIds.forEach(id => {
        if (!currentViewerIds.has(id)) {
            removedViewerIds.add(id);
        }
    });
    
    // Check animation states
    const hasNewViewers = newViewerIds.size > 0;
    const hasRemovedViewers = removedViewerIds.size > 0 || viewersJustRemoved;
    
    // Reset the flag after using it
    viewersJustRemoved = false;
    
    previousViewerIds = currentViewerIds;
    
    // Render visible avatars
    let html = shown.map(v => {
        const isNew = newViewerIds.has(v.id);
        // Determine animation class based on what happened
        let cls = '';
        if (isNew) {
            cls = ' new-viewer';
        } else if (hasNewViewers) {
            cls = ' bumped'; // Bump left when someone joins
        } else if (hasRemovedViewers) {
            cls = ' bumped-right'; // Bump right when someone leaves
        }
        
        if (v.photo) {
            return `<div class="presence-avatar presence-avatar-photo${cls}" title="${escapeHtml(v.name)}" data-user-id="${escapeHtml(v.id)}"><img src="${escapeHtml(v.photo)}" alt="${escapeHtml(v.name)}" loading="lazy"></div>`;
        }
        return `<div class="presence-avatar${cls}" style="background: ${escapeHtml(v.color)}" title="${escapeHtml(v.name)}" data-user-id="${escapeHtml(v.id)}">${escapeHtml(v.name.charAt(0).toUpperCase())}</div>`;
    }).join('');
    
    if (overflow > 0) {
        html += `<div class="presence-avatar presence-overflow" title="${overflow} more">+${overflow}</div>`;
    }
    
    container.innerHTML = html;
    
    // Create/update expanded view
    let expandedView = document.getElementById('presenceExpanded');
    if (!expandedView && totalViewers > 0) {
        expandedView = document.createElement('div');
        expandedView.id = 'presenceExpanded';
        expandedView.className = 'presence-expanded';
        document.body.appendChild(expandedView);
    }
    
    if (expandedView && totalViewers > 0) {
        const expandedHtml = currentRoomViewers.map(v => {
            const isNew = newViewerIds.has(v.id);
            // Determine animation class for expanded view
            let cls = '';
            if (isNew) {
                cls = ' new-viewer';
            } else if (hasNewViewers) {
                cls = ' bumped'; // Bump up when someone joins
            } else if (hasRemovedViewers) {
                cls = ' bumped-down'; // Bump down when someone leaves
            }
            const avatar = v.photo 
                ? `<div class="presence-avatar presence-avatar-photo${cls}"><img src="${escapeHtml(v.photo)}" alt="${escapeHtml(v.name)}" loading="lazy"></div>`
                : `<div class="presence-avatar${cls}" style="background: ${escapeHtml(v.color)}">${escapeHtml(v.name.charAt(0).toUpperCase())}</div>`;
            
            return `<div class="presence-expanded-item${cls}" data-user-id="${escapeHtml(v.id)}">${avatar}<span class="presence-expanded-name">${escapeHtml(v.name)}</span></div>`;
        }).join('');
        expandedView.innerHTML = expandedHtml;
    }
    
    // Setup hover handlers
    const presenceBar = document.getElementById('presenceBar');
    if (presenceBar && expandedView && totalViewers > 0) {
        if (presenceBar._showHandler) {
            presenceBar.removeEventListener('mouseenter', presenceBar._showHandler);
            presenceBar.removeEventListener('mouseleave', presenceBar._hideHandler);
        }
        
        presenceBar._showHandler = () => showExpandedPresence();
        presenceBar._hideHandler = () => hideExpandedPresence();
        
        presenceBar.addEventListener('mouseenter', presenceBar._showHandler);
        presenceBar.addEventListener('mouseleave', presenceBar._hideHandler);
        
        expandedView.addEventListener('mouseenter', () => expandedView.classList.add('visible'));
        expandedView.addEventListener('mouseleave', () => hideExpandedPresence());
    }
}

function showExpandedPresence() {
    const expanded = document.getElementById('presenceExpanded');
    const presenceBar = document.getElementById('presenceBar');
    if (!expanded || !presenceBar) return;
    
    const rect = presenceBar.getBoundingClientRect();
    expanded.style.display = 'block';
    expanded.style.top = `${rect.bottom + 8}px`;
    expanded.style.left = `${rect.left}px`;
    expanded.classList.add('visible');
}

function hideExpandedPresence() {
    const expanded = document.getElementById('presenceExpanded');
    if (!expanded) return;
    
    setTimeout(() => {
        if (!expanded.matches(':hover') && !document.getElementById('presenceBar')?.matches(':hover')) {
            expanded.classList.remove('visible');
            setTimeout(() => {
                if (!expanded.matches(':hover')) expanded.style.display = 'none';
            }, 200);
        }
    }, 100);
}

function animateViewerRemoval(userId, userName, callback) {
    const container = document.getElementById('presenceAvatars');
    const expandedView = document.getElementById('presenceExpanded');
    
    if (container) {
        container.querySelectorAll('.presence-avatar').forEach(avatar => {
            if (avatar.getAttribute('data-user-id') === userId || avatar.getAttribute('title') === userName) {
                avatar.classList.add('removing-viewer');
            }
        });
    }
    
    if (expandedView) {
        expandedView.querySelectorAll('.presence-expanded-item').forEach(item => {
            if (item.getAttribute('data-user-id') === userId) {
                item.classList.add('removing-viewer');
            }
        });
    }
    
    // Set flag so remaining avatars get bumped-right animation
    setTimeout(() => {
        viewersJustRemoved = true;
        callback();
    }, 500);
}

function handleDataChange(payload) {
    const { type, booking } = payload;
    
    switch (type) {
        case 'booking:created':
            if (!state.bookings.find(b => b.id === booking.id)) {
                state.bookings.push(booking);
                window.renderCalendar?.();
                window.updateCapacityDisplay?.();
            }
            break;
            
        case 'booking:updated':
        case 'booking:moved_out':
            const idx = state.bookings.findIndex(b => b.id === booking.id);
            if (idx !== -1) state.bookings[idx] = booking;
            window.renderCalendar?.();
            window.updateCapacityDisplay?.();
            break;
            
        case 'booking:deleted':
            state.bookings = state.bookings.filter(b => b.id !== booking.id);
            window.renderCalendar?.();
            window.updateCapacityDisplay?.();
            break;
    }
}

export function getSocket() {
    return socket;
}

export function simulateNewUser() {
    const testUsers = [
        { name: 'Alice Johnson', photo: 'https://i.pravatar.cc/150?img=1' },
        { name: 'Bob Smith', photo: 'https://i.pravatar.cc/150?img=12' },
        { name: 'Charlie Davis', photo: null },
        { name: 'Diana Lee', photo: 'https://i.pravatar.cc/150?img=5' },
        { name: 'Eve Martinez', photo: null }
    ];
    
    const randomUser = testUsers[Math.floor(Math.random() * testUsers.length)];
    const testUserId = 'test-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    
    const newViewer = {
        id: testUserId,
        name: randomUser.name,
        color: stringToColor(testUserId),
        photo: randomUser.photo
    };
    
    state.viewers.push(newViewer);
    renderViewers();
    console.log('✨ User joined:', randomUser.name);
    
    // Remove after 5 seconds with animation
    setTimeout(() => {
        animateViewerRemoval(testUserId, randomUser.name, () => {
            state.viewers = state.viewers.filter(v => v.id !== testUserId);
            renderViewers();
            console.log('👋 User left:', randomUser.name);
        });
    }, 5000);
}
