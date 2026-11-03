/**
 * Socket.IO Real-Time Communication
 * Handles presence tracking and live updates
 */

import { state } from './state.js';
import { stringToColor, escapeHtml, safeColor, safeImageSrc } from './utils.js';

let socket = null;
let previousViewerIds = new Set(); // Track previous viewers for animation
let viewersJustRemoved = false; // Track if viewers were just removed for reverse bump

// The Desks page has its own presence room (desks:<location>). While it is open the connection is in that
// room instead of the calendar's month room, and goes back to the calendar room when the page is left.
let desksActive = false;
let hasConnectedBefore = false;
let deskMode = { mode: 'viewing', floor: null };   // what we are doing there: viewing, or editing the layout

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
            // After a dropped connection, changes may have been missed: have the Desks page look again
            if (hasConnectedBefore && desksActive) window.deskLive?.changed({});
            hasConnectedBefore = true;
            console.log('Socket connected for user:', userName);
            state.currentRoom = null;   // a new connection is in no room yet, even if the page thinks it is
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
            if (typeof roomKey === 'string' && roomKey.startsWith('desks:')) {
                if (desksActive && roomKey === currentDeskRoomKey()) {
                    state.deskViewers = viewers;
                    renderDeskViewers();
                }
                return;
            }
            if (desksActive) return;   // a calendar update that arrived as we moved to the Desks page
            // Include all viewers (including current user)
            state.viewers = viewers;
            renderViewers();
        });

        socket.on('data:changed', (payload) => {
            // The Desks page has its own room and its own way of refreshing
            if (payload && typeof payload.roomKey === 'string' && payload.roomKey.startsWith('desks:')) {
                window.deskLive?.changed(payload);
                return;
            }
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
    const roomKey = desksActive
        ? currentDeskRoomKey()
        : `presence:${locationId}:${year}-${String(month + 1).padStart(2, '0')}`;

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
    if (desksActive) {
        state.deskViewers = [{ ...currentUser, mode: deskMode.mode, floor: deskMode.floor }];
        renderDeskViewers();
    } else if (!state.viewers.find(v => v.id === state.myUserId)) {
        state.viewers.push(currentUser);
        renderViewers();
    }

    socket.emit('presence:join', {
        roomKey,
        user: currentUser
    });
    if (desksActive) sendDeskState();
}

// ------------------------------------------------------------------ Desks page presence

const currentDeskRoomKey = () => `desks:${state.currentLocation}`;

function sendDeskState() {
    if (socket && socket.connected && desksActive) {
        socket.emit('presence:state', { mode: deskMode.mode, floor: deskMode.floor });
    }
}

/** The Desks page was opened (or came back): move this connection into the desks room */
export function enterDesksPresence(mode = 'viewing', floor = null) {
    deskMode = { mode, floor: floor === null || floor === undefined ? null : String(floor) };
    if (desksActive) {
        sendDeskState();
        return;
    }
    desksActive = true;
    state.deskViewers = [];
    state.currentRoom = null;
    joinCurrentRoom();
}

/** Say what we are doing on the Desks page: 'viewing' or 'editing' (the layout), and which floor */
export function setDesksPresenceState(mode, floor) {
    deskMode = { mode, floor: floor === null || floor === undefined ? null : String(floor) };
    const me = (state.deskViewers || []).find(v => v.id === state.myUserId);
    if (me) { me.mode = deskMode.mode; me.floor = deskMode.floor; renderDeskViewers(); }
    sendDeskState();
}

/** The Desks page was left: go back to the calendar's room */
export function leaveDesksPresence() {
    if (!desksActive) return;
    desksActive = false;
    state.deskViewers = [];
    renderDeskViewers();
    state.currentRoom = null;
    joinCurrentRoom();
}

const MAX_DESK_AVATARS = 5;

function deskStatus(viewer) {
    const floor = viewer.floor ? ` on floor ${viewer.floor}` : '';
    return viewer.mode === 'editing' ? `editing the layout${floor}` : `viewing${floor}`;
}

function deskAvatarHtml(viewer, extraClass = '') {
    const cls = `presence-avatar${viewer.mode === 'editing' ? ' presence-editing' : ''}${extraClass}`;
    const title = `${escapeHtml(viewer.name)} (${escapeHtml(deskStatus(viewer))})`;
    const photo = safeImageSrc(viewer.photo);
    return photo
        ? `<div class="${cls} presence-avatar-photo" title="${title}"><img src="${escapeHtml(photo)}" alt="${escapeHtml(viewer.name)}" loading="lazy"></div>`
        : `<div class="${cls}" style="background: ${safeColor(viewer.color, '#6B7280')}" title="${title}">${escapeHtml(String(viewer.name || '?').charAt(0).toUpperCase())}</div>`;
}

function namesList(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who is on the Desks page, with a notice when other people are editing the layout */
export function renderDeskViewers() {
    const container = document.getElementById('deskPresenceAvatars');
    if (!container) return;
    const countElement = document.getElementById('deskPresenceCount');
    const notice = document.getElementById('deskEditingNotice');
    const bar = document.getElementById('deskPresenceBar');

    const viewers = desksActive ? [...(state.deskViewers || [])] : [];
    // You always see yourself first, then the others
    viewers.sort((a, b) => (b.id === state.myUserId) - (a.id === state.myUserId));

    const shown = viewers.slice(0, MAX_DESK_AVATARS);
    const overflow = viewers.length - shown.length;
    container.innerHTML = shown.map(v => deskAvatarHtml(v)).join('') +
        (overflow > 0 ? `<div class="presence-avatar presence-overflow" title="${overflow} more">+${overflow}</div>` : '');
    if (countElement) countElement.textContent = viewers.length ? viewers.length : '';
    if (bar) bar.classList.toggle('presence-empty', viewers.length === 0);

    // Hover list with everyone's name and what they are doing
    let expanded = document.getElementById('deskPresenceExpanded');
    if (!expanded) {
        expanded = document.createElement('div');
        expanded.id = 'deskPresenceExpanded';
        expanded.className = 'presence-expanded';
        document.body.appendChild(expanded);
    }
    expanded.innerHTML = viewers.map(v => `<div class="presence-expanded-item">${deskAvatarHtml(v)}<span class="presence-expanded-name">${escapeHtml(v.name)}${v.id === state.myUserId ? ' (you)' : ''}<small class="presence-status">${escapeHtml(deskStatus(v))}</small></span></div>`).join('');
    if (bar && !bar._deskHoverWired) {
        bar._deskHoverWired = true;
        const show = () => {
            if (!expanded.children.length) return;
            const rect = bar.getBoundingClientRect();
            expanded.style.display = 'block';
            expanded.style.top = `${rect.bottom + 8}px`;
            expanded.style.left = `${Math.max(8, rect.right - 240)}px`;
            expanded.classList.add('visible');
        };
        const hide = () => setTimeout(() => {
            if (!expanded.matches(':hover') && !bar.matches(':hover')) { expanded.classList.remove('visible'); expanded.style.display = 'none'; }
        }, 150);
        bar.addEventListener('mouseenter', show);
        bar.addEventListener('mouseleave', hide);
        expanded.addEventListener('mouseleave', hide);
    }
    if (!viewers.length) expanded.style.display = 'none';

    // Heads-up when somebody else is editing the layout (two people editing at once can overwrite each other)
    if (notice) {
        const others = viewers.filter(v => v.mode === 'editing' && v.id !== state.myUserId).map(v => v.name);
        const iAmEditing = viewers.some(v => v.mode === 'editing' && v.id === state.myUserId);
        if (others.length === 0) {
            notice.hidden = true;
            notice.textContent = '';
        } else {
            notice.hidden = false;
            notice.textContent = iAmEditing
                ? `${namesList(others)} ${others.length === 1 ? 'is' : 'are'} also editing the layout. Changes you both make can overwrite each other.`
                : `${namesList(others)} ${others.length === 1 ? 'is' : 'are'} editing the layout right now, so the floor plan may change.`;
        }
    }
}

// floor-plan.js and views.js are not modules, so they reach these through window
window.deskPresence = { enter: enterDesksPresence, setState: setDesksPresenceState, leave: leaveDesksPresence };

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
        
        if (safeImageSrc(v.photo)) {
            return `<div class="presence-avatar presence-avatar-photo${cls}" title="${escapeHtml(v.name)}" data-user-id="${escapeHtml(v.id)}"><img src="${escapeHtml(safeImageSrc(v.photo))}" alt="${escapeHtml(v.name)}" loading="lazy"></div>`;
        }
        return `<div class="presence-avatar${cls}" style="background: ${safeColor(v.color, '#6B7280')}" title="${escapeHtml(v.name)}" data-user-id="${escapeHtml(v.id)}">${escapeHtml(v.name.charAt(0).toUpperCase())}</div>`;
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
            const avatar = safeImageSrc(v.photo) 
                ? `<div class="presence-avatar presence-avatar-photo${cls}"><img src="${escapeHtml(safeImageSrc(v.photo))}" alt="${escapeHtml(v.name)}" loading="lazy"></div>`
                : `<div class="presence-avatar${cls}" style="background: ${safeColor(v.color, '#6B7280')}">${escapeHtml(v.name.charAt(0).toUpperCase())}</div>`;
            
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
