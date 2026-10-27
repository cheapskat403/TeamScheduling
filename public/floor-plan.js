// ============================================
// Floor Plan & Desk Booking System
// Loaded on-demand when user navigates to Floor Plan view
// ============================================

// Utility function to escape HTML (XSS prevention)
function escapeHtmlFloorPlan(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Desk state
let deskState = {
    desks: [],            // desks on the current floor
    allDesks: [],         // desks on every floor of the current location
    deskBookings: [],     // bookings for the selected day (whole location)
    rangeBookings: [],    // bookings for the week shown in the day strip
    rangeFrom: null,
    rangeTo: null,
    floorElements: [],
    selectedDate: formatDateStr(new Date()),
    editMode: false,
    currentFloor: '1',
    selectedElement: null,
    activeTool: null,
    draggedDesk: null,
    suggestion: null,     // { deskId, reason } from "Find me a desk"
    underlay: null,       // { url, x, y, width, height } background drawing for this floor
    view: { zoom: 1, panX: 0, panY: 0 },
    baseFit: null         // fit-to-content transform, so zoom can be applied on top
};

// ---------- small helpers ----------

/**
 * Promise-based confirmation dialog. Used instead of window.confirm(), which some
 * browsers (including embedded ones) block by silently returning false.
 */
function askConfirm(message, { title = 'Are you sure?', confirmLabel = 'Delete', danger = true } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal active confirm-modal';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="modal-content modal-small">
                <div class="modal-header"><h2></h2></div>
                <div class="confirm-body">
                    <p class="confirm-text"></p>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" data-confirm="no">Cancel</button>
                        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="yes"></button>
                    </div>
                </div>
            </div>`;
        overlay.querySelector('h2').textContent = title;
        overlay.querySelector('.confirm-text').textContent = message;
        overlay.querySelector('[data-confirm="yes"]').textContent = confirmLabel;

        const finish = (answer) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(answer);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) return finish(false);
            const btn = e.target.closest('[data-confirm]');
            if (btn) finish(btn.dataset.confirm === 'yes');
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        // Default focus on the safe choice
        overlay.querySelector('[data-confirm="no"]').focus();
    });
}

function parseDay(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function addDays(str, n) {
    const d = parseDay(str);
    d.setDate(d.getDate() + n);
    return formatDateStr(d);
}

function mondayOf(str) {
    const d = parseDay(str);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return formatDateStr(d);
}

function todayStr() {
    return formatDateStr(new Date());
}

function deskInitials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).map(n => n[0].toUpperCase()).slice(0, 2).join('') || '?';
}

function deskTeam(teamId) {
    return teamId ? state.teams.find(t => t.id === teamId) : null;
}

/** Who is using the app: the Azure AD user when signed in, otherwise what they typed once */
function deskMe() {
    const u = window.currentUser;
    return {
        name: u?.name || localStorage.getItem('employeeName') || '',
        email: (u?.email || localStorage.getItem('employeeEmail') || '').toLowerCase(),
        teamId: localStorage.getItem('employeeTeamId') || null
    };
}

function isMyBooking(b) {
    const me = deskMe();
    if (me.email && b.employeeEmail) return b.employeeEmail.toLowerCase() === me.email;
    return !!me.name && (b.employeeName || '').toLowerCase() === me.name.toLowerCase();
}

function myBookingToday() {
    return deskState.deskBookings.find(isMyBooking) || null;
}

async function deskHeaders(json) {
    const headers = json ? { 'Content-Type': 'application/json' } : {};
    const token = window.getIdToken ? await window.getIdToken() : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

async function deskApi(method, url, body) {
    const response = await fetch(url, {
        method,
        headers: await deskHeaders(!!body),
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await response.json(); } catch (e) { /* empty body */ }
    if (!response.ok) {
        const message = response.status === 401
            ? 'Please sign in again and retry'
            : (data && data.error) || 'Something went wrong';
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }
    return data;
}

// ---------- loading ----------

async function loadDesks() {
    try {
        const locationId = state.currentLocation;
        const floor = deskState.currentFloor;
        const from = mondayOf(deskState.selectedDate);
        const to = addDays(from, 6);

        const [desks, bookings, elements, underlaySetting] = await Promise.all([
            fetch(`/api/desks?locationId=${locationId}`).then(r => r.json()),
            fetch(`/api/desk-bookings?locationId=${locationId}&from=${from}&to=${to}`).then(r => r.json()),
            fetch(`/api/floor-elements?locationId=${locationId}&floor=${floor}`).then(r => r.json()),
            fetch(`/api/settings/floorplan_bg_${locationId}_${floor}`).then(r => r.json()).catch(() => ({ value: null }))
        ]);
        const bg = underlaySetting && underlaySetting.value;
        deskState.underlay = bg && bg.url ? bg : null;

        deskState.allDesks = desks;
        deskState.desks = desks.filter(d => (d.floor || '1') === floor);
        deskState.rangeBookings = bookings;
        deskState.rangeFrom = from;
        deskState.rangeTo = to;
        deskState.floorElements = elements;
        deskState.deskBookings = bookings.filter(b => b.date === deskState.selectedDate);

        renderAllDesks();
    } catch (error) {
        console.error('Failed to load desks:', error);
        showToast('Could not load desks', 'error');
    }
}

function renderAllDesks() {
    renderDayStrip();
    renderFloorMap();
    renderSidePanel();
    updateDesksSubtitle();
    loadBookingPhotos();
}

/** Switch day. Stays in the loaded week when it can, otherwise reloads. */
function selectDay(dateStr) {
    deskState.selectedDate = dateStr;
    deskState.suggestion = null;
    hideDeskCard();
    const dateInput = document.getElementById('deskDateSelect');
    if (dateInput) dateInput.value = dateStr;

    if (deskState.rangeFrom && dateStr >= deskState.rangeFrom && dateStr <= deskState.rangeTo) {
        deskState.deskBookings = deskState.rangeBookings.filter(b => b.date === dateStr);
        renderAllDesks();
    } else {
        loadDesks();
    }
}

let desksViewInitialized = false;
let desksMapObserver = null;

function initDesksView() {
    const dateSelect = document.getElementById('deskDateSelect');
    const deskForm = document.getElementById('deskForm');
    const deskBookingForm = document.getElementById('deskBookingForm');
    const toggleEditBtn = document.getElementById('toggleEditMode');
    const floorSelect = document.getElementById('floorSelect');
    const deskTypeSelect = document.getElementById('deskType');

    dateSelect.value = deskState.selectedDate;
    updateFloorSelector();

    // Only add event listeners once
    if (!desksViewInitialized) {
        dateSelect.addEventListener('change', (e) => {
            if (e.target.value) selectDay(e.target.value);
        });

        document.getElementById('dayStripPrev').addEventListener('click', () => selectDay(addDays(deskState.selectedDate, -7)));
        document.getElementById('dayStripNext').addEventListener('click', () => selectDay(addDays(deskState.selectedDate, 7)));
        document.getElementById('dayStripToday').addEventListener('click', () => selectDay(todayStr()));

        document.getElementById('dayStrip').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-day]');
            if (chip) selectDay(chip.dataset.day);
        });

        floorSelect.addEventListener('change', (e) => {
            deskState.currentFloor = e.target.value;
            deskState.suggestion = null;
            deskState.view = { zoom: 1, panX: 0, panY: 0 };
            hideDeskCard();
            loadDesks();
        });

        deskForm.addEventListener('submit', handleDeskSubmit);
        deskBookingForm.addEventListener('submit', handleDeskBookingSubmit);
        toggleEditBtn.addEventListener('click', toggleEditMode);

        deskTypeSelect.addEventListener('change', (e) => {
            const teamGroup = document.getElementById('assignedTeamGroup');
            teamGroup.style.display = e.target.value === 'team_seat' ? 'block' : 'none';
        });

        // Toolbar button handlers
        document.querySelectorAll('.toolbar-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                if (tool === 'desk') {
                    openDeskModal();
                } else if (tool === 'room') {
                    openRoomModal();
                } else if (tool === 'wall') {
                    addWallElement();
                } else if (tool === 'label') {
                    openLabelModal();
                }
            });
        });

        document.getElementById('deleteSelectedBtn')?.addEventListener('click', deleteSelectedElement);
        document.getElementById('deskDeleteBtn')?.addEventListener('click', async () => {
            const id = document.getElementById('editDeskId').value;
            if (id && await deleteDesk(id)) closeDeskModal();
        });

        // Room, label and wall forms
        document.getElementById('roomForm')?.addEventListener('submit', handleRoomSubmit);
        document.getElementById('labelForm')?.addEventListener('submit', handleLabelSubmit);
        document.getElementById('wallForm')?.addEventListener('submit', handleWallSubmit);

        // Floating card: close on outside click / Escape
        document.addEventListener('click', (e) => {
            const card = document.getElementById('deskCard');
            if (!card || card.hidden) return;
            if (card.contains(e.target) || e.target.closest('.floor-desk')) return;
            hideDeskCard();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideDeskCard();
        });

        setupMapZoom();
        setupDeskHover();

        // Keep the map fitted when the layout around it changes (side panel, edit mode)
        if (window.ResizeObserver) {
            desksMapObserver = new ResizeObserver(() => scaleFloorMap());
            desksMapObserver.observe(document.getElementById('floorMapContainer'));
        }

        // Pick up other people's bookings when coming back to the tab
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !deskState.editMode &&
                document.getElementById('desksView')?.classList.contains('active')) {
                loadDesks();
            }
        });

        desksViewInitialized = true;
    }

    // Populate assigned team dropdown (sorted alphabetically)
    const teamSelect = document.getElementById('assignedTeamId');
    if (teamSelect) {
        const sortedTeams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name));
        teamSelect.innerHTML = sortedTeams.map(t =>
            `<option value="${escapeHtmlFloorPlan(t.id)}">${escapeHtmlFloorPlan(t.name)}</option>`
        ).join('');
    }

    loadDesks();
}

// Update floor selector based on current location's floor count
function updateFloorSelector() {
    const floorSelect = document.getElementById('floorSelect');
    const currentLocation = state.locations.find(l => l.id === state.currentLocation);
    const floorCount = currentLocation?.floors || 1;

    floorSelect.innerHTML = '';
    for (let i = 1; i <= floorCount; i++) {
        const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
        floorSelect.innerHTML += `<option value="${i}">${i}${suffix} Floor</option>`;
    }

    if (parseInt(deskState.currentFloor) > floorCount) {
        deskState.currentFloor = '1';
    }
    floorSelect.value = deskState.currentFloor;
    floorSelect.style.display = floorCount > 1 ? 'block' : 'none';
}

function toggleEditMode() {
    deskState.editMode = !deskState.editMode;
    const editPanel = document.getElementById('editModePanel');
    const toggleBtn = document.getElementById('toggleEditMode');
    const floorMap = document.getElementById('floorMap');

    hideDeskCard();
    deskState.view = { zoom: 1, panX: 0, panY: 0 };
    document.getElementById('desksView').classList.toggle('desks-editing', deskState.editMode);

    if (deskState.editMode) {
        editPanel.style.display = 'block';
        toggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Done Editing
        `;
        toggleBtn.classList.add('btn-primary');
        toggleBtn.classList.remove('btn-secondary');
        floorMap.classList.add('edit-mode');
    } else {
        editPanel.style.display = 'none';
        toggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit Layout
        `;
        toggleBtn.classList.remove('btn-primary');
        toggleBtn.classList.add('btn-secondary');
        floorMap.classList.remove('edit-mode');
        // Layout may have changed: refresh everything from the server
        loadDesks();
        return;
    }

    renderFloorMap();
}

// ---------- day strip + header ----------

function bookableDeskCount() {
    return deskState.allDesks.filter(d => d.deskType !== 'unavailable').length;
}

function renderDayStrip() {
    const strip = document.getElementById('dayStrip');
    if (!strip) return;

    const start = mondayOf(deskState.selectedDate);
    const today = todayStr();
    const total = bookableDeskCount();
    const deskIds = new Set(deskState.allDesks.map(d => d.id));
    let html = '';

    for (let i = 0; i < 7; i++) {
        const day = addDays(start, i);
        const d = parseDay(day);
        const booked = deskState.rangeBookings.filter(b => b.date === day && deskIds.has(b.deskId)).length;
        const free = Math.max(0, total - booked);
        const fill = total ? Math.min(100, Math.round((booked / total) * 100)) : 0;
        const level = fill >= 90 ? 'full' : fill >= 60 ? 'busy' : 'quiet';
        const classes = ['day-chip',
            day === deskState.selectedDate ? 'selected' : '',
            day === today ? 'today' : '',
            day < today ? 'past' : '',
            d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''].filter(Boolean).join(' ');

        html += `
            <button class="${classes}" data-day="${day}" role="tab" aria-selected="${day === deskState.selectedDate}"
                    aria-label="${d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}, ${free} desks free">
                <span class="day-chip-dow">${d.toLocaleDateString('en-ZA', { weekday: 'short' })}</span>
                <span class="day-chip-num">${d.getDate()}</span>
                <span class="day-chip-meter ${level}"><span style="width:${fill}%"></span></span>
                <span class="day-chip-free">${total ? `${free} free` : '–'}</span>
            </button>`;
    }
    strip.innerHTML = html;
}

function updateDesksSubtitle() {
    const el = document.getElementById('desksSubtitle');
    if (!el) return;
    const location = state.locations.find(l => l.id === state.currentLocation);
    const day = parseDay(deskState.selectedDate).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
    el.textContent = `${location ? location.name + ' · ' : ''}${day}`;
}

// ---------- map ----------

function renderFloorMap() {
    const container = document.getElementById('floorMap');
    let html = '';

    // Background drawing (if this floor has one) sits under everything
    const underlay = deskState.underlay;
    if (underlay) {
        html += `<img class="floor-underlay" src="${escapeHtmlFloorPlan(underlay.url)}" alt="" draggable="false"
                     style="left: ${underlay.x || 0}px; top: ${underlay.y || 0}px; width: ${underlay.width}px; height: ${underlay.height}px;">`;
    }

    // Rooms/walls/labels (bottom layer). The drawing already shows them, so hide them unless editing.
    const drawnElements = underlay && !deskState.editMode ? [] : deskState.floorElements;
    html += drawnElements.map(el => {
        const isSelected = deskState.selectedElement?.id === el.id;

        if (el.type === 'room') {
            const style = `left: ${el.x || 0}px; top: ${el.y || 0}px; width: ${el.width || 150}px; height: ${el.height || 120}px; ${el.color ? `border-color: ${el.color}50; background: ${el.color}08;` : ''}`;
            const resizeHandles = deskState.editMode ? `
                <div class="resize-handle nw" data-handle="nw"></div>
                <div class="resize-handle ne" data-handle="ne"></div>
                <div class="resize-handle sw" data-handle="sw"></div>
                <div class="resize-handle se" data-handle="se"></div>
                <div class="resize-handle n" data-handle="n"></div>
                <div class="resize-handle s" data-handle="s"></div>
                <div class="resize-handle e" data-handle="e"></div>
                <div class="resize-handle w" data-handle="w"></div>
            ` : '';
            return `
                <div class="floor-room ${deskState.editMode ? 'edit-mode' : ''} ${isSelected ? 'selected' : ''}"
                     id="element-${el.id}"
                     style="${style}"
                     data-element-id="${el.id}"
                     data-element-type="room">
                    ${el.label ? `<span class="room-label">${escapeHtmlFloorPlan(el.label)}</span>` : ''}
                    ${resizeHandles}
                </div>
            `;
        } else if (el.type === 'wall') {
            const rotation = el.rotation || 0;
            const width = el.width || 100;
            const height = el.height || 6;
            let style = `left: ${el.x || 0}px; top: ${el.y || 0}px; width: ${width}px; height: ${height}px;`;
            if (rotation) {
                style += ` transform: rotate(${rotation}deg); transform-origin: left center;`;
            }
            const resizeHandles = deskState.editMode ? `
                <div class="resize-handle e" data-handle="e"></div>
                <div class="resize-handle w" data-handle="w"></div>
            ` : '';
            return `
                <div class="floor-wall ${deskState.editMode ? 'edit-mode' : ''} ${isSelected ? 'selected' : ''}"
                     id="element-${el.id}"
                     style="${style}"
                     data-element-id="${el.id}"
                     data-element-type="wall"
                     onclick="selectElement('${el.id}', 'wall')">
                    ${resizeHandles}
                </div>
            `;
        } else if (el.type === 'label') {
            const style = `left: ${el.x || 0}px; top: ${el.y || 0}px;`;
            return `
                <div class="floor-label ${deskState.editMode ? 'edit-mode' : ''} ${isSelected ? 'selected' : ''}"
                     id="element-${el.id}"
                     style="${style}"
                     data-element-id="${el.id}"
                     data-element-type="label"
                     onclick="selectElement('${el.id}', 'label')">
                    ${escapeHtmlFloorPlan(el.label || '')}
                </div>
            `;
        }
        return '';
    }).join('');

    // Check if no desks
    if (deskState.desks.length === 0 && deskState.floorElements.length === 0 && !underlay) {
        html = `
            <div class="no-desks-map">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"></path>
                </svg>
                <p>No floor plan configured</p>
                <button class="btn btn-primary" onclick="toggleEditMode();">Start Editing</button>
            </div>
        `;
        container.innerHTML = html;
        return;
    }

    // Render desks
    html += deskState.desks.map(desk => {
        const booking = deskState.deskBookings.find(b => b.deskId === desk.id);
        const mine = booking && isMyBooking(booking);
        const isUnavailable = desk.deskType === 'unavailable';
        const isTeamSeat = desk.deskType === 'team_seat';

        let statusClass;
        if (isUnavailable) statusClass = 'unavailable';
        else if (booking) statusClass = mine ? 'my-booking' : 'booked';
        else if (isTeamSeat) statusClass = 'team-seat';
        else statusClass = 'hotseat';

        const team = booking ? deskTeam(booking.teamId) : (isTeamSeat ? deskTeam(desk.assignedTeamId) : null);
        const teamColor = team && team.color ? team.color : '';
        const isSelected = deskState.selectedElement?.id === desk.id;
        const isSuggested = deskState.suggestion?.deskId === desk.id;
        const chairPositions = desk.chairPositions || ['bottom'];

        let styleStr = `left: ${desk.x || 0}px; top: ${desk.y || 0}px; width: ${desk.width || 60}px; height: ${desk.height || 40}px;`;
        if (teamColor) styleStr += ` --team-color: ${teamColor};`;
        // Name and avatar scale with the desk so they fit at any size
        const deskW = desk.width || 60;
        const deskH = desk.height || 40;
        // Tall narrow desks run their name along the long side so it can be bigger
        const upright = deskH > deskW * 1.4;
        const nameLen = Math.max(String(desk.name || '').length, 3) * 0.62;
        const labelPx = upright
            ? Math.max(2.5, Math.min(9, deskW * 0.7, (deskH - 3) / nameLen))
            : Math.max(2.5, Math.min(9, deskH * 0.42, (deskW - 3) / nameLen));
        const avatarPx = Math.max(4, Math.min(20, deskH * 0.55, deskW * 0.45));
        styleStr += ` --desk-label-size: ${labelPx.toFixed(2)}px; --desk-avatar-size: ${avatarPx.toFixed(2)}px;`;

        const chairsHtml = chairPositions.map(pos => `<div class="desk-chair ${pos}"></div>`).join('');
        const compact = Math.min(desk.width || 60, desk.height || 40) <= 20;   // small desks drawn to scale get slimmer chairs and borders
        const label = booking
            ? `${desk.name}, taken by ${booking.employeeName}`
            : isUnavailable ? `${desk.name}, unavailable` : `${desk.name}, free`;

        return `
            <div class="floor-desk ${statusClass} ${compact ? 'compact' : ''} ${upright ? 'upright' : ''} ${isSelected ? 'selected' : ''} ${isSuggested ? 'suggested' : ''} ${deskState.editMode ? 'draggable' : ''}"
                 id="desk-${desk.id}"
                 style="${styleStr}"
                 data-desk-id="${desk.id}"
                 tabindex="0" role="button"
                 aria-label="${escapeHtmlFloorPlan(label)}"
                 onclick="handleDeskClick('${desk.id}', event)"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();handleDeskClick('${desk.id}', event)}">
                ${chairsHtml}
                <div class="desk-label">${escapeHtmlFloorPlan(desk.name)}</div>
                ${booking ? `<div class="desk-avatar">${escapeHtmlFloorPlan(deskInitials(booking.employeeName))}</div>` : ''}
                ${deskState.editMode ? `
                    <div class="desk-edit-controls">
                        <button onclick="event.stopPropagation(); deleteDesk('${desk.id}')" title="Delete">×</button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = html;
    applyDeskPhotos();

    if (deskState.editMode) {
        setupDeskDragging();
        setupElementDragging();
    }

    requestAnimationFrame(() => scaleFloorMap());
}

// Bounding box of everything drawn on the current floor (desks, chairs, rooms, walls, labels)
function floorContentBounds() {
    // With no drawing the editor shows the whole canvas so desks can go anywhere
    if (deskState.editMode && !deskState.underlay) return { x: 0, y: 0, w: 1200, h: 800 };
    const pad = 24; // room for chairs sticking out of the desks
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y, w, h) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    };

    // Editing: fit the whole drawing. Booking: fit the desks (the drawing is much bigger than them).
    if (deskState.underlay && (deskState.editMode || deskState.desks.length === 0)) {
        const u = deskState.underlay;
        grow(u.x || 0, u.y || 0, u.width, u.height);
    }
    deskState.desks.forEach(d => grow((d.x || 0) - pad, (d.y || 0) - pad, (d.width || 60) + pad * 2, (d.height || 40) + pad * 2));
    (deskState.underlay && !deskState.editMode ? [] : deskState.floorElements).forEach(el => {
        const w = el.width || (el.type === 'label' ? 120 : 100);
        const h = el.height || (el.type === 'label' ? 24 : 6);
        if (el.type === 'wall' && el.rotation) {
            // Rotated walls swing around their left end: use a square of the wall's length
            grow((el.x || 0) - w, (el.y || 0) - w, w * 2, w * 2);
        } else {
            grow(el.x || 0, el.y || 0, w, h);
        }
    });

    if (!isFinite(minX)) return { x: 0, y: 0, w: 1200, h: 800 };
    minX = Math.max(0, minX - 8);
    minY = Math.max(0, minY - 8);
    maxX = Math.min(1200, maxX + 8);
    maxY = Math.min(800, maxY + 8);
    const bounds = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };

    // Booking over a drawing: show a sensible chunk of the plan around the desks (at least 60% of it),
    // and never pan past the drawing's edges so there is no empty space beside it.
    const u = deskState.underlay;
    if (u && !deskState.editMode) {
        const limit = { x: u.x || 0, y: u.y || 0, w: u.width, h: u.height };
        const w = Math.min(limit.w, Math.max(bounds.w, limit.w * 0.6));
        const h = Math.min(limit.h, Math.max(bounds.h, limit.h * 0.6));
        const cx = bounds.x + bounds.w / 2;
        const cy = bounds.y + bounds.h / 2;
        return {
            x: Math.max(limit.x, Math.min(cx - w / 2, limit.x + limit.w - w)),
            y: Math.max(limit.y, Math.min(cy - h / 2, limit.y + limit.h - h)),
            w, h, limit
        };
    }
    return bounds;
}

// Scale floor map to fit its container. While booking it zooms to the floor plan's
// actual content; while editing it shows the whole canvas so desks can go anywhere.
function scaleFloorMap() {
    const floorMap = document.getElementById('floorMap');
    const container = document.querySelector('.floor-map-container');

    if (!floorMap || !container) return;

    const area = floorContentBounds();

    floorMap.style.transition = 'none';

    const containerRect = container.getBoundingClientRect();
    const availableWidth = containerRect.width - 24;
    const availableHeight = containerRect.height - 24;

    // Skip if container has no size yet (hidden view)
    if (availableWidth <= 0 || availableHeight <= 0) {
        return;
    }

    const maxScale = deskState.editMode ? 1 : 1.6;
    const scale = Math.min(availableWidth / area.w, availableHeight / area.h, maxScale);

    // Centre the content area in the container (the map's own origin is its top-left corner)
    let offsetX = (containerRect.width - area.w * scale) / 2 - area.x * scale;
    let offsetY = (containerRect.height - area.h * scale) / 2 - area.y * scale;

    if (area.limit) {
        // The container is usually a different shape from the area, so more of the drawing than
        // the area is visible. Keep that visible window inside the drawing instead of over empty space.
        const lim = area.limit;
        const visW = containerRect.width / scale;
        const visH = containerRect.height / scale;
        const fit = (areaStart, areaSize, visSize, limStart, limSize) => {
            if (visSize >= limSize) return limStart - (visSize - limSize) / 2;   // whole drawing fits: centre it
            const start = areaStart + areaSize / 2 - visSize / 2;
            return Math.max(limStart, Math.min(start, limStart + limSize - visSize));
        };
        offsetX = -fit(area.x, area.w, visW, lim.x, lim.w) * scale;
        offsetY = -fit(area.y, area.h, visH, lim.y, lim.h) * scale;
    }
    deskState.baseFit = { scale, offsetX, offsetY, cx: containerRect.width / 2, cy: containerRect.height / 2 };
    applyMapTransform();

    requestAnimationFrame(() => {
        floorMap.style.transition = '';
    });
}


// Fit-to-content transform with the user's zoom and pan layered on top
function applyMapTransform() {
    hideDeskHover();   // a tooltip would be left behind where the desk used to be
    const floorMap = document.getElementById('floorMap');
    const fit = deskState.baseFit;
    if (!floorMap || !fit) return;
    const { zoom, panX, panY } = deskState.view;
    floorMap.style.setProperty('--map-inv-scale', Math.min(12, 1 / (fit.scale * zoom)).toFixed(3));
    floorMap.style.transformOrigin = 'top left';
    floorMap.style.transform =
        `translate(${panX}px, ${panY}px) translate(${fit.cx}px, ${fit.cy}px) scale(${zoom}) translate(${-fit.cx}px, ${-fit.cy}px) ` +
        `translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scale})`;
}

function resetMapView() {
    deskState.view = { zoom: 1, panX: 0, panY: 0 };
    applyMapTransform();
}

/** Zoom by a factor around a point (container coordinates; defaults to the centre) */
function zoomMap(factor, px, py) {
    const fit = deskState.baseFit;
    if (!fit) return;
    const v = deskState.view;
    const p = { x: px ?? fit.cx, y: py ?? fit.cy };
    const newZoom = Math.max(0.4, Math.min(10, v.zoom * factor));
    if (newZoom === v.zoom) return;
    const ratio = newZoom / v.zoom;
    // Keep the point under the cursor where it is
    v.panX = p.x - fit.cx - ratio * (p.x - v.panX - fit.cx);
    v.panY = p.y - fit.cy - ratio * (p.y - v.panY - fit.cy);
    v.zoom = newZoom;
    if (newZoom === 1) { v.panX = 0; v.panY = 0; }
    applyMapTransform();
}

/** Zoom in on one desk so it is comfortable to read and click */
function zoomToDesk(desk) {
    const fit = deskState.baseFit;
    if (!fit) return;
    const c = deskCenter(desk);
    const qx = fit.offsetX + fit.scale * c.x;
    const qy = fit.offsetY + fit.scale * c.y;
    const target = Math.max(1, Math.min(10, 80 / (Math.max(desk.width || 60, 1) * fit.scale)));
    deskState.view = { zoom: target, panX: -target * (qx - fit.cx), panY: -target * (qy - fit.cy) };
    applyMapTransform();
}

function setupMapZoom() {
    const container = document.getElementById('floorMapContainer');
    const wrapper = container.closest('.floor-map-wrapper');

    document.getElementById('mapZoomIn')?.addEventListener('click', () => zoomMap(1.5));
    document.getElementById('mapZoomOut')?.addEventListener('click', () => zoomMap(1 / 1.5));
    document.getElementById('mapZoomReset')?.addEventListener('click', resetMapView);

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        zoomMap(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Drag to pan with a mouse (touch keeps native scrolling; use the buttons there)
    let drag = null;
    let suppressClick = false;
    container.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // While editing, only the empty background pans (desks and rooms have their own dragging)
        if (deskState.editMode && e.target !== container && e.target.id !== 'floorMap') return;
        drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        drag.x = e.clientX;
        drag.y = e.clientY;
        deskState.view.panX += dx;
        deskState.view.panY += dy;
        const map = document.getElementById('floorMap');
        map.style.transition = 'none';
        applyMapTransform();
        wrapper.classList.add('panning');
    });
    window.addEventListener('pointerup', () => {
        if (!drag) return;
        if (drag.moved) {
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
        }
        drag = null;
        wrapper.classList.remove('panning');
        document.getElementById('floorMap').style.transition = '';
    });
    // A drag must not count as a click on whatever desk it ended on
    container.addEventListener('click', (e) => {
        if (suppressClick) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
}

// Add resize listener for floor map scaling (debounced)
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (document.getElementById('desksView')?.classList.contains('active')) {
            scaleFloorMap();
            hideDeskCard();
        }
    }, 100);
});

// ---------- clicking a desk ----------

function handleDeskClick(deskId, event) {
    const desk = deskState.allDesks.find(d => d.id === deskId) || deskState.desks.find(d => d.id === deskId);
    if (!desk) return;

    if (deskState.editMode) {
        // The click that ends a drag must not open the editor
        if (Date.now() - (deskState.lastDragEnd || 0) < 400) return;
        editDesk(deskId);
        return;
    }

    const booking = deskState.deskBookings.find(b => b.deskId === deskId);
    const anchor = document.getElementById(`desk-${deskId}`);
    const past = deskState.selectedDate < todayStr();

    // Taken, mine, unavailable, past: just show the card
    if (booking || desk.deskType === 'unavailable' || past) {
        showDeskCard(desk, anchor);
        return;
    }

    // Free: someone else's team seat or an existing booking of mine needs a decision
    const reservedForOthers = desk.deskType === 'team_seat' && desk.assignedTeamId !== deskMe().teamId;
    if (reservedForOthers || myBookingToday()) {
        showDeskCard(desk, anchor);
        return;
    }

    // Free and nothing in the way: one click books it (with undo)
    bookDesk(desk);
}

// ---------- profile photos (from Azure AD, same source as the Office bookings) ----------

const deskPhotoCache = new Map();     // email -> data URL, or null when the person has no photo
const deskPhotoPending = new Map();   // email -> in-flight promise (so each person is fetched once)
const PHOTO_TTL_MS = 24 * 60 * 60 * 1000;      // keep a photo for a day
const NO_PHOTO_TTL_MS = 60 * 60 * 1000;        // re-check "no photo" after an hour

/** data attribute that lets applyDeskPhotos() find an avatar and swap in the picture */
function photoAttr(booking) {
    const email = (booking && booking.employeeEmail || '').trim().toLowerCase();
    return email ? ` data-photo-email="${escapeHtmlFloorPlan(email)}"` : '';
}

function readStoredPhoto(email) {
    try {
        const raw = localStorage.getItem(`deskPhoto:${email}`);
        if (!raw) return undefined;
        const { url, t } = JSON.parse(raw);
        const ttl = url ? PHOTO_TTL_MS : NO_PHOTO_TTL_MS;
        if (Date.now() - t > ttl) return undefined;
        return url || null;
    } catch (e) {
        return undefined;
    }
}

function storePhoto(email, url) {
    try {
        localStorage.setItem(`deskPhoto:${email}`, JSON.stringify({ url, t: Date.now() }));
    } catch (e) { /* storage full or blocked: the in-memory cache still works */ }
}

/** Fetch one person's photo via Microsoft Graph (uses the signed-in user's token). Resolves to a data URL or null. */
function loadDeskPhoto(email) {
    if (deskPhotoCache.has(email)) return Promise.resolve(deskPhotoCache.get(email));
    const stored = readStoredPhoto(email);
    if (stored !== undefined) {
        deskPhotoCache.set(email, stored);
        return Promise.resolve(stored);
    }
    if (deskPhotoPending.has(email)) return deskPhotoPending.get(email);

    const request = (async () => {
        let url = null;
        try {
            if (typeof window.fetchUserPhotoById === 'function') {
                url = await window.fetchUserPhotoById(email);
            }
        } catch (e) { url = null; }
        deskPhotoCache.set(email, url || null);
        // Only remember a miss when we were actually signed in to Azure; otherwise we'd hide photos for an hour
        if (url || window.currentUser) storePhoto(email, url || null);
        deskPhotoPending.delete(email);
        return url || null;
    })();
    deskPhotoPending.set(email, request);
    return request;
}

function setAvatarPhoto(el, url) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add('has-photo');
}

/** Put cached photos onto every avatar currently on screen (initials stay as the fallback) */
function applyDeskPhotos() {
    document.querySelectorAll('[data-photo-email]').forEach(el => {
        const url = deskPhotoCache.get(el.dataset.photoEmail);
        if (url && !el.classList.contains('has-photo')) setAvatarPhoto(el, url);
    });
}

/** Load photos for everyone booked on the selected day, a few at a time, updating the page as they arrive */
async function loadBookingPhotos() {
    const emails = [...new Set(deskState.deskBookings
        .map(b => (b.employeeEmail || '').trim().toLowerCase())
        .filter(Boolean))];
    const todo = emails.filter(e => !deskPhotoCache.has(e));
    applyDeskPhotos();
    if (!todo.length) return;

    let next = 0;
    const worker = async () => {
        while (next < todo.length) {
            const email = todo[next++];
            await loadDeskPhoto(email);
            applyDeskPhotos();
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
}

// ---------- hover card ----------

let deskHoverId = null;

function ensureHoverEl() {
    let el = document.getElementById('deskHover');
    if (!el) {
        el = document.createElement('div');
        el.id = 'deskHover';
        el.className = 'desk-hover';
        el.setAttribute('role', 'tooltip');
        el.hidden = true;
        document.body.appendChild(el);
    }
    return el;
}

function hideDeskHover() {
    deskHoverId = null;
    const el = document.getElementById('deskHover');
    if (el) el.hidden = true;
}

function showDeskHover(desk, anchor) {
    const el = ensureHoverEl();
    const booking = deskState.deskBookings.find(b => b.deskId === desk.id);
    const place = [desk.name, desk.zone].filter(Boolean).join(' · ');

    if (booking) {
        const team = deskTeam(booking.teamId);
        const mine = isMyBooking(booking);
        const status = booking.checkedIn ? 'Checked in' : (deskState.selectedDate === todayStr() ? 'Not checked in yet' : 'Booked');
        el.innerHTML = `
            <div class="hover-person">
                <span class="avatar lg"${photoAttr(booking)} style="--team-color: ${escapeHtmlFloorPlan(team?.color || '')}">${escapeHtmlFloorPlan(deskInitials(booking.employeeName))}</span>
                <div class="hover-text">
                    <div class="hover-name">${escapeHtmlFloorPlan(booking.employeeName)}${mine ? ' (you)' : ''}</div>
                    <div class="hover-sub">${escapeHtmlFloorPlan(team?.name || 'No team')}</div>
                </div>
            </div>
            <div class="hover-meta"><span>${escapeHtmlFloorPlan(place)}</span><span class="${booking.checkedIn ? 'hover-ok' : ''}">${escapeHtmlFloorPlan(status)}</span></div>`;
    } else if (desk.deskType === 'unavailable') {
        el.innerHTML = `<div class="hover-name">${escapeHtmlFloorPlan(desk.name)}</div><div class="hover-sub">Unavailable</div>`;
    } else {
        const reserved = desk.deskType === 'team_seat' ? `Reserved for ${deskTeam(desk.assignedTeamId)?.name || 'a team'}` : 'Free';
        el.innerHTML = `<div class="hover-name">${escapeHtmlFloorPlan(place)}</div><div class="hover-sub">${escapeHtmlFloorPlan(reserved)}</div>`;
    }

    el.hidden = false;
    applyDeskPhotos();
    deskHoverId = desk.id;

    // Above the desk, centred; flip below when there is no room, and keep it on screen
    const a = anchor.getBoundingClientRect();
    const h = el.getBoundingClientRect();
    const margin = 8;
    let left = a.left + a.width / 2 - h.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - h.width - margin));
    let top = a.top - h.height - 10;
    if (top < margin) top = a.bottom + 10;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

function setupDeskHover() {
    const map = document.getElementById('floorMap');
    const container = document.getElementById('floorMapContainer');

    map.addEventListener('mouseover', (e) => {
        if (deskState.editMode) return;
        const deskEl = e.target.closest('.floor-desk');
        if (!deskEl) return;
        const card = document.getElementById('deskCard');
        if (card && !card.hidden) return;          // the click card is open: don't stack a tooltip on it
        if (deskHoverId === deskEl.dataset.deskId) return;
        const desk = deskState.desks.find(d => d.id === deskEl.dataset.deskId);
        if (desk) showDeskHover(desk, deskEl);
    });

    map.addEventListener('mouseout', (e) => {
        const from = e.target.closest('.floor-desk');
        if (!from) return;
        const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.floor-desk') : null;
        if (to !== from) hideDeskHover();
    });

    // Moving, zooming or clicking makes the tooltip stale
    container.addEventListener('wheel', hideDeskHover, { passive: true });
    container.addEventListener('pointerdown', hideDeskHover);
    window.addEventListener('scroll', hideDeskHover, true);
}

// ---------- floating desk card ----------

function hideDeskCard() {
    const card = document.getElementById('deskCard');
    if (card) card.hidden = true;
}

function showDeskCard(desk, anchor) {
    const card = document.getElementById('deskCard');
    if (!card) return;

    const booking = deskState.deskBookings.find(b => b.deskId === desk.id);
    const mine = booking && isMyBooking(booking);
    const past = deskState.selectedDate < todayStr();
    const isToday = deskState.selectedDate === todayStr();
    const myCurrent = myBookingToday();
    const suggestion = deskState.suggestion?.deskId === desk.id ? deskState.suggestion : null;
    const assignedTeam = deskTeam(desk.assignedTeamId);
    const meta = [desk.zone, desk.floor && (deskState.allDesks.some(d => (d.floor || '1') !== '1') ? `Floor ${desk.floor}` : '')]
        .filter(Boolean).join(' · ');

    let status = '';
    let actions = '';

    if (desk.deskType === 'unavailable') {
        status = `<div class="card-status muted">This desk is unavailable</div>`;
    } else if (booking) {
        const team = deskTeam(booking.teamId);
        status = `
            <div class="card-person">
                <span class="avatar"${photoAttr(booking)} style="--team-color: ${escapeHtmlFloorPlan(team?.color || '')}">${escapeHtmlFloorPlan(deskInitials(booking.employeeName))}</span>
                <div>
                    <div class="card-person-name">${escapeHtmlFloorPlan(booking.employeeName)}${mine ? ' (you)' : ''}</div>
                    <div class="card-person-sub">${escapeHtmlFloorPlan(team?.name || 'No team')}</div>
                </div>
            </div>
            ${booking.checkedIn
                ? `<div class="card-status ok">✓ Checked in</div>`
                : mine && isToday ? `<div class="card-status muted">Scan the QR code at your desk to check in</div>` : ''}`;
        if (mine && !past) {
            actions = `<button class="btn btn-danger btn-small" data-card-action="cancel" data-booking-id="${escapeHtmlFloorPlan(booking.id)}">Cancel booking</button>`;
        }
    } else if (past) {
        status = `<div class="card-status muted">This day has passed</div>`;
    } else {
        if (suggestion) {
            status += `<div class="card-suggest">Suggested for you · ${escapeHtmlFloorPlan(suggestion.reason)}</div>`;
        }
        if (desk.deskType === 'team_seat') {
            status += `<div class="card-status warn">Reserved for ${escapeHtmlFloorPlan(assignedTeam?.name || 'a team')}</div>`;
        }
        if (myCurrent) {
            status += `<div class="card-status muted">You're at ${escapeHtmlFloorPlan(myCurrent.deskName)} today</div>`;
            actions = `<button class="btn btn-primary btn-small" data-card-action="move">Move here</button>`;
        } else {
            actions = `<button class="btn btn-primary btn-small" data-card-action="book">${desk.deskType === 'team_seat' ? 'Book anyway' : 'Book this desk'}</button>`;
        }
    }

    card.innerHTML = `
        <div class="card-head">
            <div>
                <div class="card-title">${escapeHtmlFloorPlan(desk.name)}</div>
                ${meta ? `<div class="card-meta">${escapeHtmlFloorPlan(meta)}</div>` : ''}
            </div>
            <button class="card-close" aria-label="Close" data-card-action="close">×</button>
        </div>
        ${status}
        ${actions ? `<div class="card-actions">${actions}</div>` : ''}
    `;

    applyDeskPhotos();
    hideDeskHover();

    card.onclick = async (e) => {
        const btn = e.target.closest('[data-card-action]');
        if (!btn) return;
        const act = btn.dataset.cardAction;
        if (act === 'close') return hideDeskCard();
        if (act === 'book') { hideDeskCard(); return bookDesk(desk); }
        if (act === 'move') { hideDeskCard(); return moveToDesk(desk); }
        if (act === 'cancel') { hideDeskCard(); return cancelMyBooking(btn.dataset.bookingId); }
    };

    card.hidden = false;
    positionDeskCard(card, anchor);
}

function positionDeskCard(card, anchor) {
    // On phones the CSS turns the card into a bottom sheet
    if (window.innerWidth <= 768 || !anchor) {
        card.style.left = '';
        card.style.top = '';
        return;
    }
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const margin = 12;
    let left = a.left + a.width / 2 - c.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - c.width - margin));
    let top = a.bottom + 10;
    if (top + c.height > window.innerHeight - margin) top = Math.max(margin, a.top - c.height - 10);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
}

// ---------- booking ----------

/** A toast with an action button (used for Undo) */
function showDeskToast(message, actionLabel, onAction) {
    const container = document.getElementById('toastContainer');
    if (!container) return showToast(message, 'success');

    const toast = document.createElement('div');
    toast.className = 'toast success toast-with-action';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<span></span><button type="button" class="toast-action"></button>`;
    toast.firstChild.textContent = message;
    const btn = toast.querySelector('button');
    btn.textContent = actionLabel;

    const close = () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    };
    btn.addEventListener('click', () => { close(); onAction(); });

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(close, 7000);
}

async function refreshBookings() {
    const from = deskState.rangeFrom || mondayOf(deskState.selectedDate);
    const to = deskState.rangeTo || addDays(from, 6);
    deskState.rangeBookings = await fetch(`/api/desk-bookings?locationId=${state.currentLocation}&from=${from}&to=${to}`).then(r => r.json());
    deskState.deskBookings = deskState.rangeBookings.filter(b => b.date === deskState.selectedDate);
    renderAllDesks();
}

async function bookDesk(desk) {
    const me = deskMe();
    if (!me.name) {
        showQuickBookModal(desk);
        return;
    }

    const deskEl = document.getElementById(`desk-${desk.id}`);
    deskEl?.classList.add('booking');

    try {
        const booking = await deskApi('POST', '/api/desk-bookings', {
            deskId: desk.id,
            date: deskState.selectedDate,
            employeeName: me.name,
            employeeEmail: me.email,
            teamId: me.teamId
        });
        deskState.suggestion = null;
        await refreshBookings();
        showDeskToast(`${desk.name} is yours for the day`, 'Undo', () => cancelMyBooking(booking.id, true));
    } catch (error) {
        showToast(error.message || 'Failed to book desk', 'error');
        // Someone may have just taken it: show the truth
        await refreshBookings().catch(() => {});
    } finally {
        deskEl?.classList.remove('booking');
    }
}

async function moveToDesk(desk) {
    const current = myBookingToday();
    if (!current) return bookDesk(desk);
    try {
        await deskApi('DELETE', `/api/desk-bookings/${current.id}`);
    } catch (error) {
        showToast(error.message || 'Could not move your booking', 'error');
        return;
    }
    const me = deskMe();
    try {
        const booking = await deskApi('POST', '/api/desk-bookings', {
            deskId: desk.id,
            date: deskState.selectedDate,
            employeeName: me.name,
            employeeEmail: me.email,
            teamId: me.teamId
        });
        deskState.suggestion = null;
        await refreshBookings();
        showDeskToast(`Moved to ${desk.name}`, 'Undo', async () => {
            await cancelMyBooking(booking.id, true);
            const old = deskState.allDesks.find(d => d.id === current.deskId);
            if (old) bookDesk(old);
        });
    } catch (error) {
        // Put them back where they were rather than leaving them with nothing
        try {
            await deskApi('POST', '/api/desk-bookings', {
                deskId: current.deskId, date: current.date,
                employeeName: me.name, employeeEmail: me.email, teamId: me.teamId
            });
        } catch (e) { /* best effort */ }
        showToast(error.message || 'That desk was just taken', 'error');
        await refreshBookings().catch(() => {});
    }
}

async function cancelMyBooking(bookingId, silent) {
    try {
        await deskApi('DELETE', `/api/desk-bookings/${bookingId}`);
        await refreshBookings();
        if (!silent) {
            showToast('Booking cancelled', 'success');
        }
    } catch (error) {
        showToast(error.message || 'Failed to cancel booking', 'error');
    }
}

// Show quick book modal for users without a name yet
function showQuickBookModal(desk) {
    const savedTeamId = localStorage.getItem('employeeTeamId');
    const prefillName = window.currentUser?.name || localStorage.getItem('employeeName') || '';

    const popup = document.createElement('div');
    popup.className = 'desk-info-popup';
    popup.innerHTML = `
        <div class="desk-info-popup-content quick-book">
            <button class="popup-close" onclick="this.closest('.desk-info-popup').remove()">×</button>
            <div class="popup-header">
                <h3>Book ${escapeHtmlFloorPlan(desk.name)}</h3>
            </div>
            <p class="popup-hint">Please sign in with Azure AD for automatic booking, or enter your name below.</p>
            <form id="quickBookForm" class="quick-book-form">
                <div class="form-group">
                    <input type="text" id="quickBookName" required placeholder="Your name" value="${escapeHtmlFloorPlan(prefillName)}" autofocus>
                </div>
                <div class="form-group">
                    <select id="quickBookTeam">
                        <option value="">Team (optional)</option>
                        ${state.teams.map(team =>
                            `<option value="${escapeHtmlFloorPlan(team.id)}" ${team.id === savedTeamId ? 'selected' : ''}>${escapeHtmlFloorPlan(team.name)}</option>`
                        ).join('')}
                    </select>
                </div>
                <button type="submit" class="btn btn-primary btn-full">Book Desk</button>
            </form>
        </div>
    `;

    document.querySelectorAll('.desk-info-popup').forEach(p => p.remove());
    document.body.appendChild(popup);
    setTimeout(() => document.getElementById('quickBookName')?.focus(), 100);

    document.getElementById('quickBookForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('quickBookName').value.trim();
        const teamId = document.getElementById('quickBookTeam').value || null;
        if (!name) return;

        localStorage.setItem('employeeName', name);
        if (teamId) localStorage.setItem('employeeTeamId', teamId);

        popup.remove();
        await bookDesk(desk);
    });

    popup.addEventListener('click', (e) => {
        if (e.target === popup) popup.remove();
    });

    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            popup.remove();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// ---------- side panel: my day + who's in ----------

function renderSidePanel() {
    renderMyDayCard();
    renderWhosIn();
}

function renderMyDayCard() {
    const card = document.getElementById('myDayCard');
    if (!card) return;

    const past = deskState.selectedDate < todayStr();
    const dayLabel = parseDay(deskState.selectedDate).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'short' });
    const mine = myBookingToday();
    const me = deskMe();

    if (mine) {
        const desk = deskState.allDesks.find(d => d.id === mine.deskId);
        const meta = [desk?.zone, desk && deskState.allDesks.some(d => (d.floor || '1') !== '1') ? `Floor ${desk.floor || '1'}` : '']
            .filter(Boolean).join(' · ');
        card.innerHTML = `
            <div class="side-eyebrow">Your desk · ${escapeHtmlFloorPlan(dayLabel)}</div>
            <div class="my-desk-name">${escapeHtmlFloorPlan(mine.deskName)}</div>
            ${meta ? `<div class="my-desk-meta">${escapeHtmlFloorPlan(meta)}</div>` : ''}
            ${mine.checkedIn ? `<div class="card-status ok">✓ Checked in</div>` : ''}
            <div class="side-actions">
                <button class="btn btn-secondary btn-small" id="showMyDeskBtn">Show on map</button>
                ${past ? '' : `<button class="btn btn-danger btn-small" id="cancelMyDeskBtn">Cancel</button>`}
            </div>`;
        document.getElementById('showMyDeskBtn').onclick = () => focusDesk(mine.deskId);
        const cancelBtn = document.getElementById('cancelMyDeskBtn');
        if (cancelBtn) cancelBtn.onclick = () => cancelMyBooking(mine.id);
        return;
    }

    const free = deskState.allDesks.filter(d => d.deskType !== 'unavailable').length - deskState.deskBookings.length;
    card.innerHTML = `
        <div class="side-eyebrow">${escapeHtmlFloorPlan(dayLabel)}</div>
        <div class="my-desk-name muted">${past ? 'No desk booked' : 'No desk yet'}</div>
        ${me.name || window.currentUser ? '' : `<div class="my-desk-meta">Click a desk and enter your name to book.</div>`}
        ${past ? '' : `<button class="btn btn-primary btn-full" id="findDeskBtn" ${free > 0 ? '' : 'disabled'}>
            ${free > 0 ? 'Find me a desk' : 'Fully booked'}
        </button>`}`;
    const btn = document.getElementById('findDeskBtn');
    if (btn) btn.onclick = findMeADesk;
}

function renderWhosIn() {
    const list = document.getElementById('whosInList');
    const count = document.getElementById('whosInCount');
    if (!list) return;

    const bookings = [...deskState.deskBookings].sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
    count.textContent = bookings.length;

    if (!bookings.length) {
        list.innerHTML = `<p class="whos-in-empty">Nobody has booked a desk for this day yet.</p>`;
        return;
    }

    const groups = new Map();
    for (const b of bookings) {
        const team = deskTeam(b.teamId);
        const key = team ? team.id : '';
        if (!groups.has(key)) groups.set(key, { team, people: [] });
        groups.get(key).people.push(b);
    }
    const ordered = [...groups.values()].sort((a, b) => {
        if (!a.team) return 1;
        if (!b.team) return -1;
        return a.team.name.localeCompare(b.team.name);
    });

    list.innerHTML = ordered.map(g => `
        <div class="whos-in-group">
            <div class="whos-in-team">
                <span class="team-dot" style="background: ${escapeHtmlFloorPlan(g.team?.color || '#6b7a8c')}"></span>
                ${escapeHtmlFloorPlan(g.team?.name || 'No team')}
                <span class="whos-in-team-count">${g.people.length}</span>
            </div>
            ${g.people.map(b => `
                <button class="whos-in-row ${isMyBooking(b) ? 'me' : ''}" data-desk-id="${escapeHtmlFloorPlan(b.deskId)}">
                    <span class="avatar sm"${photoAttr(b)} style="--team-color: ${escapeHtmlFloorPlan(g.team?.color || '')}">${escapeHtmlFloorPlan(deskInitials(b.employeeName))}</span>
                    <span class="whos-in-name">${escapeHtmlFloorPlan(b.employeeName)}${isMyBooking(b) ? ' (you)' : ''}</span>
                    <span class="whos-in-desk">${escapeHtmlFloorPlan(b.deskName)}</span>
                </button>`).join('')}
        </div>`).join('');

    applyDeskPhotos();
    list.querySelectorAll('.whos-in-row').forEach(row => {
        row.onclick = () => focusDesk(row.dataset.deskId);
    });
}

// ---------- find me a desk / focus ----------

/** Switch floor if needed, then highlight a desk and open its card */
async function focusDesk(deskId, { suggestion } = {}) {
    const desk = deskState.allDesks.find(d => d.id === deskId);
    if (!desk) return;

    if (suggestion) deskState.suggestion = suggestion;

    const floor = String(desk.floor || '1');
    if (floor !== String(deskState.currentFloor)) {
        deskState.currentFloor = floor;
        document.getElementById('floorSelect').value = floor;
        deskState.view = { zoom: 1, panX: 0, panY: 0 };
        await loadDesks();
    } else {
        renderFloorMap();
        renderSidePanel();
    }

    hideDeskCard();
    requestAnimationFrame(() => {
        const el = document.getElementById(`desk-${deskId}`);
        if (!el) return;
        zoomToDesk(desk);
        el.classList.add('pulse');
        setTimeout(() => el.classList.remove('pulse'), 2400);
        // Wait for the zoom animation so the card lands next to the desk
        setTimeout(() => showDeskCard(desk, el), 280);
    });
}

function deskCenter(d) {
    return { x: (d.x || 0) + (d.width || 60) / 2, y: (d.y || 0) + (d.height || 40) / 2 };
}

/** Pick the best free desk: next to teammates if any are in, else the team's own seats, else the first free one */
function pickDeskSuggestion() {
    const me = deskMe();
    const taken = new Set(deskState.deskBookings.map(b => b.deskId));
    const free = deskState.allDesks.filter(d =>
        d.deskType !== 'unavailable' && !taken.has(d.id) &&
        (d.deskType !== 'team_seat' || (me.teamId && d.assignedTeamId === me.teamId)));
    if (!free.length) return null;

    const mates = me.teamId
        ? deskState.deskBookings
            .filter(b => b.teamId === me.teamId && !isMyBooking(b))
            .map(b => deskState.allDesks.find(d => d.id === b.deskId))
            .filter(Boolean)
        : [];

    const floorPenalty = (d) => String(d.floor || '1') === String(deskState.currentFloor) ? 0 : 100000;
    let best = null;

    for (const d of free) {
        let score;
        let reason;
        if (mates.length) {
            const c = deskCenter(d);
            score = Math.min(...mates.map(m => {
                if (String(m.floor || '1') !== String(d.floor || '1')) return 100000;
                const mc = deskCenter(m);
                return Math.hypot(c.x - mc.x, c.y - mc.y);
            }));
            reason = mates.length === 1 ? 'next to a teammate' : `close to ${mates.length} teammates`;
        } else if (d.deskType === 'team_seat') {
            score = floorPenalty(d) - 50000;
            reason = 'reserved for your team';
        } else {
            const c = deskCenter(d);
            score = floorPenalty(d) + (d.y || 0) * 2000 + (d.x || 0);
            reason = 'first free desk';
        }
        if (!best || score < best.score) best = { desk: d, score, reason };
    }
    return { deskId: best.desk.id, reason: best.reason };
}

function findMeADesk() {
    const suggestion = pickDeskSuggestion();
    if (!suggestion) {
        showToast('No free desks for this day', 'warning');
        return;
    }
    focusDesk(suggestion.deskId, { suggestion });
}

function selectElement(elementId, elementType) {
    if (!deskState.editMode) return;
    
    const element = deskState.floorElements.find(e => e.id === elementId);
    if (!element) return;
    
    deskState.selectedElement = { ...element, elementType };
    
    // Update UI
    document.getElementById('selectedElementInfo').textContent = `${elementType}: ${element.label || elementId}`;
    document.getElementById('deleteSelectedBtn').style.display = 'flex';
    
    // Re-render to show selection without full reload
    document.querySelectorAll('.floor-room, .floor-wall, .floor-label').forEach(el => {
        el.classList.remove('selected');
    });
    const elDiv = document.getElementById(`element-${elementId}`);
    if (elDiv) elDiv.classList.add('selected');
}

// Handle click on floor elements (separate from drag)
function handleFloorElementClick(e) {
    if (!deskState.editMode) return;
    if (dragState.active) return; // Don't select if dragging
    
    const element = e.target.closest('.floor-room, .floor-wall, .floor-label');
    if (!element) return;
    
    const elementId = element.dataset.elementId;
    const elementType = element.dataset.elementType;
    
    if (elementId && elementType) {
        selectElement(elementId, elementType);
    }
}

async function deleteSelectedElement() {
    if (!deskState.selectedElement) return;
    
    const el = deskState.selectedElement;
    
    if (el.elementType) {
        // Floor element
        if (!(await askConfirm(`Delete this ${el.elementType}?`, { title: `Delete ${el.elementType}`, confirmLabel: 'Delete' }))) return;
        try {
            // Get ID token for authentication
            const token = window.getIdToken ? await window.getIdToken() : null;
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            await fetch(`/api/floor-elements/${el.id}`, { 
                method: 'DELETE',
                headers
            });
            showToast(`${el.elementType} deleted`, 'success');
            loadDesks();
        } catch (error) {
            showToast('Failed to delete', 'error');
        }
    } else {
        // Desk
        deleteDesk(el.id);
    }
    
    deskState.selectedElement = null;
    document.getElementById('selectedElementInfo').textContent = 'None';
    document.getElementById('deleteSelectedBtn').style.display = 'none';
}

// Global drag state to avoid listener conflicts
let dragState = {
    active: false,
    didMove: false, // Track if we actually moved
    type: null, // 'move' or 'resize'
    elementId: null,
    elementType: null,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    initialWidth: 0,
    initialHeight: 0,
    resizeHandle: null
};

function setupElementDragging() {
    const floorMap = document.getElementById('floorMap');
    
    // Use a flag to track if we've added listeners
    if (!floorMap.dataset.listenersAdded) {
        floorMap.addEventListener('mousedown', handleElementMouseDown);
        floorMap.addEventListener('click', handleFloorElementClick);
        document.addEventListener('mousemove', handleElementMouseMove);
        document.addEventListener('mouseup', handleElementMouseUp);
        floorMap.dataset.listenersAdded = 'true';
    }
}

/** Total on-screen scale of the map (fit-to-content times the user's zoom) */
function mapScale() {
    const map = document.getElementById('floorMap');
    return (map.getBoundingClientRect().width / map.offsetWidth) || 1;
}

/** Grid snap in canvas px: coarse for the plain canvas, fine over a drawing */
function snapStep() {
    return deskState.underlay ? 1 : 10;
}

function handleElementMouseDown(e) {
    if (!deskState.editMode) return;
    
    const target = e.target;
    const floorMap = document.getElementById('floorMap');
    const mapRect = floorMap.getBoundingClientRect();
    
    // Check if clicking on a resize handle
    if (target.classList.contains('resize-handle')) {
        const parent = target.closest('.floor-room, .floor-wall');
        if (!parent) return;
        
        const rect = parent.getBoundingClientRect();
        dragState = {
            active: true,
            didMove: false,
            type: 'resize',
            elementId: parent.dataset.elementId,
            elementType: parent.dataset.elementType,
            startX: e.clientX,
            startY: e.clientY,
            initialX: parseInt(parent.style.left) || 0,
            initialY: parseInt(parent.style.top) || 0,
            initialWidth: parseInt(parent.style.width) || 100,
            initialHeight: parseInt(parent.style.height) || 100,
            resizeHandle: target.dataset.handle
        };
        
        parent.classList.add('resizing');
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    // Check if clicking on a draggable element
    const element = target.closest('.floor-room.edit-mode, .floor-wall.edit-mode, .floor-label.edit-mode');
    if (!element) return;
    
    const rect = element.getBoundingClientRect();
    
    dragState = {
        active: true,
        didMove: false,
        type: 'move',
        elementId: element.dataset.elementId,
        elementType: element.dataset.elementType,
        startX: e.clientX,
        startY: e.clientY,
        initialX: (rect.left - mapRect.left) / mapScale() + floorMap.scrollLeft,
        initialY: (rect.top - mapRect.top) / mapScale() + floorMap.scrollTop,
        initialWidth: parseInt(element.style.width) || 100,
        initialHeight: parseInt(element.style.height) || 100,
        resizeHandle: null
    };
    
    element.classList.add('dragging');
    e.preventDefault();
    e.stopPropagation();
}

function handleElementMouseMove(e) {
    if (!dragState.active) return;
    
    const element = document.getElementById(`element-${dragState.elementId}`);
    if (!element) return;
    
    const k = mapScale();
    const deltaX = (e.clientX - dragState.startX) / k;
    const deltaY = (e.clientY - dragState.startY) / k;
    const snap = snapStep();

    // Track if we've moved enough to count as a drag
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        dragState.didMove = true;
    }
    
    if (dragState.type === 'move') {
        let newX = dragState.initialX + deltaX;
        let newY = dragState.initialY + deltaY;
        
        // Snap to grid
        newX = Math.round(newX / snap) * snap;
        newY = Math.round(newY / snap) * snap;
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);

        element.style.left = `${newX}px`;
        element.style.top = `${newY}px`;
    } else if (dragState.type === 'resize') {
        let newWidth = dragState.initialWidth;
        let newHeight = dragState.initialHeight;
        let newX = dragState.initialX;
        let newY = dragState.initialY;
        
        const handle = dragState.resizeHandle;
        const minWidth = 30;
        const minHeight = 4;
        
        if (handle.includes('e')) {
            // East handle: right edge moves, left edge (x) stays fixed
            newWidth = Math.max(minWidth, dragState.initialWidth + deltaX);
        }
        if (handle.includes('w')) {
            // West handle: left edge moves, right edge stays fixed
            // Calculate new width first, then derive position from it
            const proposedWidth = dragState.initialWidth - deltaX;
            newWidth = Math.max(minWidth, proposedWidth);
            // Position = original right edge - new width
            const rightEdge = dragState.initialX + dragState.initialWidth;
            newX = rightEdge - newWidth;
        }
        if (handle.includes('s')) {
            // South handle: bottom edge moves, top edge (y) stays fixed
            newHeight = Math.max(minHeight, dragState.initialHeight + deltaY);
        }
        if (handle.includes('n')) {
            // North handle: top edge moves, bottom edge stays fixed
            // Calculate new height first, then derive position from it
            const proposedHeight = dragState.initialHeight - deltaY;
            newHeight = Math.max(minHeight, proposedHeight);
            // Position = original bottom edge - new height
            const bottomEdge = dragState.initialY + dragState.initialHeight;
            newY = bottomEdge - newHeight;
        }
        
        // Snap to grid
        newWidth = Math.round(newWidth / snap) * snap;
        newHeight = Math.round(newHeight / snap) * snap;
        newX = Math.round(newX / snap) * snap;
        newY = Math.round(newY / snap) * snap;
        
        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;
        element.style.left = `${newX}px`;
        element.style.top = `${newY}px`;
    }
}

async function handleElementMouseUp(e) {
    if (!dragState.active) return;
    
    const element = document.getElementById(`element-${dragState.elementId}`);
    if (element) {
        element.classList.remove('dragging', 'resizing');
        
        // Only save if we actually moved/resized
        if (dragState.didMove) {
            const newX = parseInt(element.style.left) || 0;
            const newY = parseInt(element.style.top) || 0;
            const newWidth = parseInt(element.style.width) || 100;
            const newHeight = parseInt(element.style.height) || 100;
            
            try {
                // Get ID token for authentication
                const token = window.getIdToken ? await window.getIdToken() : null;
                const headers = { 'Content-Type': 'application/json' };
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                
                const response = await fetch(`/api/floor-elements/${dragState.elementId}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ x: newX, y: newY, width: newWidth, height: newHeight })
                });
                
                if (response.ok) {
                    // Update local state
                    const idx = deskState.floorElements.findIndex(el => el.id === dragState.elementId);
                    if (idx !== -1) {
                        deskState.floorElements[idx].x = newX;
                        deskState.floorElements[idx].y = newY;
                        deskState.floorElements[idx].width = newWidth;
                        deskState.floorElements[idx].height = newHeight;
                    }
                    console.log('Element position saved:', { x: newX, y: newY, width: newWidth, height: newHeight });
                }
            } catch (error) {
                console.error('Failed to save element position:', error);
                showToast('Failed to save position', 'error');
            }
        }
    }
    
    // Reset drag state
    dragState = {
        active: false,
        didMove: false,
        type: null,
        elementId: null,
        elementType: null,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        initialWidth: 0,
        initialHeight: 0,
        resizeHandle: null
    };
}

function setupDeskDragging() {
    const floorMap = document.getElementById('floorMap');
    const desks = floorMap.querySelectorAll('.floor-desk.draggable');
    
    desks.forEach(deskEl => {
        let isDragging = false;
        let dragMoved = false;
        let startX, startY, initialX, initialY;

        deskEl.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;

            isDragging = true;
            dragMoved = false;
            deskEl.classList.add('dragging');
            
            const rect = deskEl.getBoundingClientRect();
            const mapRect = floorMap.getBoundingClientRect();
            
            startX = e.clientX;
            startY = e.clientY;
            initialX = (rect.left - mapRect.left) / mapScale();
            initialY = (rect.top - mapRect.top) / mapScale();

            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            // Ignore tiny wobbles so a plain click is still a click
            if (!dragMoved && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
            dragMoved = true;

            const k = mapScale();
            const deltaX = (e.clientX - startX) / k;
            const deltaY = (e.clientY - startY) / k;
            const snap = snapStep();

            let newX = initialX + deltaX;
            let newY = initialY + deltaY;

            // Snap to grid
            newX = Math.round(newX / snap) * snap;
            newY = Math.round(newY / snap) * snap;
            
            // Keep within bounds
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);
            
            deskEl.style.left = `${newX}px`;
            deskEl.style.top = `${newY}px`;
        });
        
        document.addEventListener('mouseup', async () => {
            if (!isDragging) return;
            
            isDragging = false;
            deskEl.classList.remove('dragging');

            // Nothing moved: it was a click, let it open the editor. Otherwise swallow the click that follows the drop.
            if (!dragMoved) return;
            deskState.lastDragEnd = Date.now();

            // Save new position
            const deskId = deskEl.dataset.deskId;
            const newX = parseInt(deskEl.style.left);
            const newY = parseInt(deskEl.style.top);
            
            try {
                // Get ID token for authentication
                const token = window.getIdToken ? await window.getIdToken() : null;
                const headers = { 'Content-Type': 'application/json' };
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                
                await fetch(`/api/desks/${deskId}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ x: newX, y: newY })
                });
                
                // Update local state
                const desk = deskState.desks.find(d => d.id === deskId);
                if (desk) {
                    desk.x = newX;
                    desk.y = newY;
                }
            } catch (error) {
                console.error('Failed to save desk position:', error);
            }
        });
    });
}

// Keep the old grid view function as a fallback
function renderDesksGrid() {
    renderFloorMap();
}

function openDeskModal(deskId = null) {
    const modal = document.getElementById('deskModal');
    const title = document.getElementById('deskModalTitle');
    const submitBtn = document.getElementById('deskFormSubmitBtn');
    const locationInput = document.getElementById('deskLocationInput');
    const deskTypeSelect = document.getElementById('deskType');
    const assignedTeamGroup = document.getElementById('assignedTeamGroup');
    const assignedTeamSelect = document.getElementById('assignedTeamId');
    
    // Populate location select with current location selected (sorted alphabetically)
    const sortedLocations = [...state.locations].sort((a, b) => a.name.localeCompare(b.name));
    locationInput.innerHTML = sortedLocations.map(loc => 
        `<option value="${escapeHtmlFloorPlan(loc.id)}" ${loc.id === state.currentLocation ? 'selected' : ''}>${escapeHtmlFloorPlan(loc.name)}</option>`
    ).join('');
    
    // Populate team select (sorted alphabetically)
    const sortedTeams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name));
    assignedTeamSelect.innerHTML = sortedTeams.map(t => 
        `<option value="${escapeHtmlFloorPlan(t.id)}">${escapeHtmlFloorPlan(t.name)}</option>`
    ).join('');
    
    if (deskId) {
        const desk = deskState.desks.find(d => d.id === deskId);
        if (desk) {
            document.getElementById('editDeskId').value = desk.id;
            document.getElementById('deskName').value = desk.name;
            document.getElementById('deskFloor').value = desk.floor || deskState.currentFloor;
            document.getElementById('deskZone').value = desk.zone || '';
            document.getElementById('deskWidth').value = desk.width || 60;
            document.getElementById('deskHeight').value = desk.height || 40;
            deskTypeSelect.value = desk.deskType || 'hotseat';
            assignedTeamGroup.style.display = desk.deskType === 'team_seat' ? 'block' : 'none';
            if (desk.assignedTeamId) assignedTeamSelect.value = desk.assignedTeamId;
            locationInput.value = desk.locationId;
            
            // Set chair positions
            document.querySelectorAll('input[name="chairPos"]').forEach(cb => {
                cb.checked = (desk.chairPositions || ['bottom']).includes(cb.value);
            });
            
            title.textContent = 'Edit Desk';
            submitBtn.textContent = 'Save Changes';
            document.getElementById('deskDeleteBtn').style.display = '';
        }
    } else {
        document.getElementById('deskForm').reset();
        document.getElementById('editDeskId').value = '';
        document.getElementById('deskFloor').value = deskState.currentFloor;
        document.getElementById('deskWidth').value = 60;
        document.getElementById('deskHeight').value = 40;
        deskTypeSelect.value = 'hotseat';
        assignedTeamGroup.style.display = 'none';
        
        // Reset chair positions to default
        document.querySelectorAll('input[name="chairPos"]').forEach(cb => {
            cb.checked = cb.value === 'bottom';
        });
        
        title.textContent = 'Add Desk';
        submitBtn.textContent = 'Add Desk';
        document.getElementById('deskDeleteBtn').style.display = 'none';
    }
    
    modal.classList.add('active');
}

function closeDeskModal() {
    document.getElementById('deskModal').classList.remove('active');
    document.getElementById('deskForm').reset();
    document.getElementById('editDeskId').value = '';
}

async function handleDeskSubmit(e) {
    e.preventDefault();
    
    const editDeskId = document.getElementById('editDeskId').value;
    const name = document.getElementById('deskName').value;
    const locationId = document.getElementById('deskLocationInput').value;
    const floor = document.getElementById('deskFloor').value || deskState.currentFloor;
    const zone = document.getElementById('deskZone').value;
    const width = parseInt(document.getElementById('deskWidth').value) || 60;
    const height = parseInt(document.getElementById('deskHeight').value) || 40;
    const deskType = document.getElementById('deskType').value;
    const assignedTeamId = deskType === 'team_seat' ? document.getElementById('assignedTeamId').value : null;
    
    // Get chair positions
    const chairPositions = Array.from(document.querySelectorAll('input[name="chairPos"]:checked'))
        .map(cb => cb.value);
    
    // Calculate initial position for new desks (grid layout)
    const existingDesks = deskState.desks;
    const x = existingDesks.length > 0 ? (existingDesks.length % 8) * 90 + 50 : 50;
    const y = existingDesks.length > 0 ? Math.floor(existingDesks.length / 8) * 80 + 80 : 80;
    
    const deskData = { 
        name, locationId, floor, zone, width, height, 
        deskType, assignedTeamId, chairPositions 
    };
    
    try {
        // Get ID token for authentication
        const token = window.getIdToken ? await window.getIdToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        let response;
        if (editDeskId) {
            response = await fetch(`/api/desks/${editDeskId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(deskData)
            });
        } else {
            response = await fetch('/api/desks', {
                method: 'POST',
                headers,
                body: JSON.stringify({ ...deskData, x, y })
            });
        }
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }
        
        showToast(editDeskId ? 'Desk updated' : 'Desk created', 'success');
        closeDeskModal();
        loadDesks();
        
    } catch (error) {
        showToast(error.message || 'Failed to save desk', 'error');
    }
}

function editDesk(deskId) {
    openDeskModal(deskId);
}

async function deleteDesk(deskId) {
    if (!(await askConfirm('All bookings for this desk will also be deleted. This cannot be undone.', { title: 'Delete this desk?', confirmLabel: 'Delete desk' }))) return false;

    try {
        await deskApi('DELETE', `/api/desks/${deskId}`);
        showToast('Desk deleted', 'success');
        loadDesks();
        return true;
    } catch (error) {
        showToast(error.message || 'Failed to delete desk', 'error');
        return false;
    }
}

// Room modal functions
function openRoomModal(roomId = null) {
    const modal = document.getElementById('roomModal');
    const form = document.getElementById('roomForm');
    
    if (roomId) {
        const room = deskState.floorElements.find(e => e.id === roomId);
        if (room) {
            document.getElementById('editRoomId').value = room.id;
            document.getElementById('roomLabel').value = room.label || '';
            document.getElementById('roomWidth').value = room.width || 150;
            document.getElementById('roomHeight').value = room.height || 120;
            document.getElementById('roomColor').value = room.color || '#3b82f6';
        }
    } else {
        form.reset();
        document.getElementById('editRoomId').value = '';
    }
    
    modal.classList.add('active');
}

function closeRoomModal() {
    document.getElementById('roomModal').classList.remove('active');
}

async function handleRoomSubmit(e) {
    e.preventDefault();
    
    const editRoomId = document.getElementById('editRoomId').value;
    const label = document.getElementById('roomLabel').value;
    const width = parseInt(document.getElementById('roomWidth').value);
    const height = parseInt(document.getElementById('roomHeight').value);
    const color = document.getElementById('roomColor').value;
    
    const roomData = {
        type: 'room',
        locationId: state.currentLocation,
        floor: deskState.currentFloor,
        label,
        width,
        height,
        color,
        x: 50,
        y: 50
    };
    
    try {
        // Get ID token for authentication
        const token = window.getIdToken ? await window.getIdToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        if (editRoomId) {
            await fetch(`/api/floor-elements/${editRoomId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(roomData)
            });
        } else {
            await fetch('/api/floor-elements', {
                method: 'POST',
                headers,
                body: JSON.stringify(roomData)
            });
        }
        
        showToast(editRoomId ? 'Room updated' : 'Room added', 'success');
        closeRoomModal();
        loadDesks();
    } catch (error) {
        showToast('Failed to save room', 'error');
    }
}

// Wall functions
function openWallModal() {
    document.getElementById('wallModal').classList.add('active');
    document.getElementById('editWallId').value = '';
    document.getElementById('wallLength').value = 100;
    document.getElementById('wallThickness').value = 6;
    document.querySelector('input[name="wallOrientation"][value="0"]').checked = true;
}

function closeWallModal() {
    document.getElementById('wallModal').classList.remove('active');
    document.getElementById('wallForm').reset();
}

async function handleWallSubmit(e) {
    e.preventDefault();
    
    const length = parseInt(document.getElementById('wallLength').value) || 100;
    const thickness = parseInt(document.getElementById('wallThickness').value) || 6;
    const rotation = parseInt(document.querySelector('input[name="wallOrientation"]:checked').value) || 0;
    const editWallId = document.getElementById('editWallId').value;
    
    try {
        // Get ID token for authentication
        const token = window.getIdToken ? await window.getIdToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        if (editWallId) {
            // Update existing wall
            await fetch(`/api/floor-elements/${editWallId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    width: length,
                    height: thickness,
                    rotation: rotation
                })
            });
            showToast('Wall updated', 'success');
        } else {
            // Add new wall
            await fetch('/api/floor-elements', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    type: 'wall',
                    locationId: state.currentLocation,
                    floor: deskState.currentFloor,
                    x: 100,
                    y: 100,
                    width: length,
                    height: thickness,
                    rotation: rotation
                })
            });
            showToast('Wall added - drag to position', 'success');
        }
        
        closeWallModal();
        loadDesks();
    } catch (error) {
        showToast('Failed to save wall', 'error');
    }
}

function addWallElement() {
    openWallModal();
}

// Label modal functions
function openLabelModal(labelId = null) {
    const modal = document.getElementById('labelModal');
    const form = document.getElementById('labelForm');
    
    if (labelId) {
        const label = deskState.floorElements.find(e => e.id === labelId);
        if (label) {
            document.getElementById('editLabelId').value = label.id;
            document.getElementById('labelText').value = label.label || '';
        }
    } else {
        form.reset();
        document.getElementById('editLabelId').value = '';
    }
    
    modal.classList.add('active');
}

function closeLabelModal() {
    document.getElementById('labelModal').classList.remove('active');
}

async function handleLabelSubmit(e) {
    e.preventDefault();
    
    const editLabelId = document.getElementById('editLabelId').value;
    const labelText = document.getElementById('labelText').value;
    
    const labelData = {
        type: 'label',
        locationId: state.currentLocation,
        floor: deskState.currentFloor,
        label: labelText,
        x: 100,
        y: 100
    };
    
    try {
        // Get ID token for authentication
        const token = window.getIdToken ? await window.getIdToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        if (editLabelId) {
            await fetch(`/api/floor-elements/${editLabelId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(labelData)
            });
        } else {
            await fetch('/api/floor-elements', {
                method: 'POST',
                headers,
                body: JSON.stringify(labelData)
            });
        }
        
        showToast(editLabelId ? 'Label updated' : 'Label added', 'success');
        closeLabelModal();
        loadDesks();
    } catch (error) {
        showToast('Failed to save label', 'error');
    }
}

function openDeskBookingModal(deskId) {
    const desk = deskState.desks.find(d => d.id === deskId);
    if (!desk) return;
    
    const modal = document.getElementById('deskBookingModal');
    const infoDiv = document.getElementById('deskBookingInfo');
    const bookingForm = document.getElementById('deskBookingForm');
    const location = state.locations.find(l => l.id === desk.locationId);
    
    // Check if desk is already booked for this day
    const existingBooking = deskState.deskBookings.find(b => b.deskId === deskId);
    const isBooked = !!existingBooking;
    
    document.getElementById('bookingDeskId').value = deskId;
    document.getElementById('bookingDate').value = deskState.selectedDate;
    
    // Show/hide the booking form based on whether desk is already booked
    bookingForm.style.display = isBooked ? 'none' : 'block';
    
    if (!isBooked) {
        // Use Azure AD user info or localStorage
        const savedName = window.currentUser?.name || localStorage.getItem('employeeName');
        const savedEmail = window.currentUser?.email || localStorage.getItem('employeeEmail');
        const savedTeamId = localStorage.getItem('employeeTeamId');
        if (savedName) document.getElementById('employeeName').value = savedName;
        if (savedEmail) document.getElementById('employeeEmail').value = savedEmail;
        
        // Populate team selector (sorted alphabetically)
        const teamSelect = document.getElementById('deskBookingTeam');
        const sortedTeams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name));
        teamSelect.innerHTML = '<option value="">-- No team --</option>' + 
            sortedTeams.map(team => 
                `<option value="${escapeHtmlFloorPlan(team.id)}" ${team.id === savedTeamId ? 'selected' : ''} style="color: ${escapeHtmlFloorPlan(team.color)}">${escapeHtmlFloorPlan(team.name)}</option>`
            ).join('');
    }
    
    infoDiv.innerHTML = `
        <h3>${escapeHtmlFloorPlan(desk.name)}</h3>
        <p>${escapeHtmlFloorPlan(location?.name || '')} ${desk.floor ? `• Floor ${desk.floor}` : ''} ${desk.zone ? `• ${escapeHtmlFloorPlan(desk.zone)}` : ''}</p>
        <p class="booking-date">${new Date(deskState.selectedDate).toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p class="booking-type">${isBooked ? 'Currently Booked' : 'Full Day Booking'}</p>
    `;
    
    renderDeskBookingsList(deskId);
    
    modal.classList.add('active');
}

function closeDeskBookingModal() {
    document.getElementById('deskBookingModal').classList.remove('active');
    document.getElementById('deskBookingForm').reset();
    document.getElementById('deskBookingForm').style.display = 'block'; // Reset form visibility
}

async function handleDeskBookingSubmit(e) {
    console.log('===== handleDeskBookingSubmit CALLED =====');
    e.preventDefault();
    
    const deskId = document.getElementById('bookingDeskId').value;
    const date = document.getElementById('bookingDate').value;
    const employeeName = document.getElementById('employeeName').value;
    const employeeEmail = document.getElementById('employeeEmail').value;
    const teamId = document.getElementById('deskBookingTeam').value || null;
    
    // Save to localStorage for convenience
    localStorage.setItem('employeeName', employeeName);
    if (employeeEmail) localStorage.setItem('employeeEmail', employeeEmail);
    if (teamId) localStorage.setItem('employeeTeamId', teamId);
    
    try {
        // Get ID token for authentication
        const token = window.getIdToken ? await window.getIdToken() : null;
        
        if (!token) {
            showToast('Authentication required. Please refresh and sign in again.', 'error');
            return;
        }
        
        const headers = { 'Content-Type': 'application/json' };
        headers['Authorization'] = `Bearer ${token}`;
        
        const response = await fetch('/api/desk-bookings', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                deskId,
                date,
                employeeName,
                employeeEmail,
                teamId
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }
        
        showToast('Desk booked for the day!', 'success');
        
        // Reload bookings and close modal
        await refreshBookings();
        closeDeskBookingModal();
        
    } catch (error) {
        showToast(error.message || 'Failed to book desk', 'error');
    }
}

function renderDeskBookingsList(deskId) {
    const container = document.getElementById('deskBookingsList');
    const deskBookings = deskState.deskBookings.filter(b => b.deskId === deskId);
    
    if (deskBookings.length === 0) {
        container.innerHTML = '<p class="hint">No bookings for this day</p>';
        return;
    }
    
    container.innerHTML = deskBookings.map(booking => {
        return `
            <div class="desk-booking-item ${booking.checkedIn ? 'checked-in' : ''}">
                <div class="booking-person">${booking.employeeName}</div>
                <div class="booking-duration">Full Day</div>
                ${booking.checkedIn ? '<span class="checked-in-badge">Checked In</span>' : ''}
                <button class="btn btn-small btn-danger" data-booking-id="${booking.id}" data-desk-id="${deskId}" onclick="cancelDeskBooking(this.dataset.bookingId, this.dataset.deskId)">Cancel</button>
            </div>
        `;
    }).join('');
}

async function cancelDeskBooking(bookingId, deskId) {
    if (!(await askConfirm('Cancel this booking?', { title: 'Cancel booking', confirmLabel: 'Cancel booking' }))) return;
    
    try {
        // Get ID token for authentication
        const token = window.getIdToken ? await window.getIdToken() : null;
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        await fetch(`/api/desk-bookings/${bookingId}`, { 
            method: 'DELETE',
            headers
        });
        showToast('Booking cancelled', 'success');
        
        // Reload
        await refreshBookings();
        renderDeskBookingsList(deskId);
        closeDeskBookingModal();
        
    } catch (error) {
        showToast('Failed to cancel booking', 'error');
    }
}

function showDeskQR(deskId) {
    const desk = deskState.desks.find(d => d.id === deskId);
    if (!desk) return;
    
    const qrUrl = `${window.location.origin}/checkin.html?code=${desk.qrCode}`;
    
    // Generate QR code using a free API
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`;
    
    // Create a modal to show the QR code
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'qrModal';
    modal.innerHTML = `
        <div class="modal-content modal-small" style="text-align: center;">
            <div class="modal-header">
                <h2>QR Code: ${desk.name}</h2>
                <button class="modal-close" onclick="document.getElementById('qrModal').remove()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div style="padding: 2rem;">
                <img src="${qrImageUrl}" alt="QR Code" style="max-width: 200px; border-radius: 8px; background: white; padding: 10px;">
                <p style="margin-top: 1rem; color: var(--text-secondary); font-size: 0.9rem;">
                    Scan this QR code at the desk to check in
                </p>
                <p style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-muted); word-break: break-all;">
                    ${qrUrl}
                </p>
                <button class="btn btn-primary" style="margin-top: 1rem;" onclick="window.open('${qrImageUrl}', '_blank')">
                    Download QR Code
                </button>
            </div>
        </div>
    `;
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    document.body.appendChild(modal);
}

// Mark module as loaded
window.floorPlanLoaded = true;

// Expose functions globally for main.js to call
window.initDesksView = initDesksView;
window.loadDesks = loadDesks;
window.updateFloorSelector = updateFloorSelector;
window.toggleEditMode = toggleEditMode;
window.openDeskModal = openDeskModal;
window.closeDeskModal = closeDeskModal;
window.handleDeskClick = handleDeskClick;
window.selectElement = selectElement;
window.deleteSelectedElement = deleteSelectedElement;
window.handleFloorElementClick = handleFloorElementClick;
window.bookDesk = bookDesk;
window.showQuickBookModal = showQuickBookModal;
window.findMeADesk = findMeADesk;
window.cancelDeskBooking = cancelDeskBooking;
window.deleteDesk = deleteDesk;
window.openRoomModal = openRoomModal;
window.closeRoomModal = closeRoomModal;
window.openWallModal = openWallModal;
window.closeWallModal = closeWallModal;
window.openLabelModal = openLabelModal;
window.closeLabelModal = closeLabelModal;
window.openDeskBookingModal = openDeskBookingModal;
window.closeDeskBookingModal = closeDeskBookingModal;
window.showDeskQR = showDeskQR;

console.log('Floor plan module loaded');
