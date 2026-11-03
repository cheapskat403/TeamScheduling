/**
 * Socket.IO presence management
 * Tracks which users are viewing which rooms:
 *   - the Calendar: one room per location and month (presence:<location>:<yyyy-mm>)
 *   - the Desks page: one room per location (desks:<location>), where each viewer is also either
 *     "viewing" or "editing" the layout, and says which floor they are looking at
 * A connection is in one room at a time: opening the Desks page leaves the calendar room and the other way round.
 */

const { checks, ValidationError } = require('../utils/validate');

const ROOM_KEY = /^presence:[A-Za-z0-9_-]{1,100}:\d{4}-(?:0[1-9]|1[0-2])$/;
const DESK_ROOM_KEY = /^desks:[A-Za-z0-9_-]{1,100}$/;
const HSL_COLOR = /^hsl\(-?\d{1,3}, \d{1,3}%, \d{1,3}%\)$/;
const MAX_ROOMS = 500;
const MAX_USER_ID = 100;
const MODES = ['viewing', 'editing'];
// A browser cannot flood a room with state changes: a normal person sends a few (opening the page, switching
// floor, starting and stopping editing), so this only ever stops a script.
const STATE_WINDOW_MS = 5000;
const STATE_MAX_PER_WINDOW = 10;

const isValidRoomKey = (roomKey) => typeof roomKey === 'string' && (ROOM_KEY.test(roomKey) || DESK_ROOM_KEY.test(roomKey));

/**
 * Builds the presence entry for a viewer from what the browser sent. Names, colours and photos are
 * shown to everyone in the room, so only plain, size-limited values get through. When the connection
 * was logged in (REQUIRE_AUTH), the id and name come from the verified token, not from the browser.
 */
function cleanPresenceUser(user, authUser) {
    const attempt = (fn, fallback) => { try { return fn(); } catch (e) { if (e instanceof ValidationError) return fallback; throw e; } };
    const rawId = authUser && authUser.id ? authUser.id : user && user.id;
    if (typeof rawId !== 'string' && typeof rawId !== 'number') return null;
    const id = String(rawId).replace(/[^ -~]/g, '').slice(0, MAX_USER_ID);
    if (!id) return null;
    const rawName = authUser && authUser.name ? authUser.name : user && user.name;
    const name = attempt(() => checks.str(100)(typeof rawName === 'string' ? rawName : '', 'name'), '') || 'Someone';
    // The browser picks hsl() colours for people; accept those and hex, nothing else
    const sentColor = user && user.color;
    const color = (typeof sentColor === 'string' && HSL_COLOR.test(sentColor))
        ? sentColor
        : (attempt(() => checks.color(sentColor, 'color'), '') || '#6B7280');
    const photo = attempt(() => checks.image(user && user.photo, 'photo'), '') || '';
    return { id, name, color, photo };
}

/** What a viewer says about what they are doing on the Desks page: { mode, floor }, both cleaned */
function cleanDeskState(payload) {
    const mode = payload && MODES.includes(payload.mode) ? payload.mode : 'viewing';
    let floor = null;
    if (payload && (typeof payload.floor === 'string' || typeof payload.floor === 'number')) {
        try { floor = String(checks.floor(String(payload.floor), 'floor')); } catch (e) { if (!(e instanceof ValidationError)) throw e; }
    }
    return { mode, floor };
}

// Presence: roomKey -> Map(userId -> { user: {id,name,color,photo}, sockets: Map(socket -> { mode, floor }) })
// One person can have several tabs open, so a viewer is listed once however many connections they have.
const presenceRooms = new Map();

function ensurePresenceRoom(roomKey) {
    if (!presenceRooms.has(roomKey)) presenceRooms.set(roomKey, new Map());
    return presenceRooms.get(roomKey);
}

/** The viewers of a room as sent to the browsers. On the Desks page each also has { mode, floor }. */
function describeViewers(roomKey, room) {
    const isDesks = DESK_ROOM_KEY.test(roomKey);
    return Array.from(room.values()).map(entry => {
        if (!isDesks) return entry.user;
        const states = Array.from(entry.sockets.values());
        // Editing in any tab counts as editing; otherwise the newest tab says which floor they are on
        const current = states.find(s => s.mode === 'editing') || states[states.length - 1] || { mode: 'viewing', floor: null };
        return { ...entry.user, mode: current.mode, floor: current.floor };
    });
}

function broadcastPresence(io, roomKey) {
    const room = presenceRooms.get(roomKey);
    if (!room) return;
    io.to(roomKey).emit('presence:update', { roomKey, viewers: describeViewers(roomKey, room) });
}

/** Takes this connection out of the room it is in. Returns the room key it left, or null. */
function leaveRoom(io, socket, { leaveSocketRoom }) {
    const roomKey = socket.data.roomKey;
    const userId = socket.data.user && socket.data.user.id;
    if (!roomKey || !userId) return null;

    if (leaveSocketRoom) socket.leave(roomKey);
    const room = presenceRooms.get(roomKey);
    if (room) {
        const entry = room.get(userId);
        if (entry) {
            entry.sockets.delete(socket);
            if (entry.sockets.size === 0) room.delete(userId);
        }
        if (room.size === 0) presenceRooms.delete(roomKey);
    }
    broadcastPresence(io, roomKey);
    return roomKey;
}

/** Only admins can edit the layout. Nothing is enforced without logins (REQUIRE_AUTH), as elsewhere. */
async function mayEditLayout(socket) {
    // Loaded here, not at the top: it pulls in the database client
    const { permissionsFor, enforced } = require('../utils/permissions');
    if (!enforced()) return true;
    const authUser = socket.data.authUser;
    if (!authUser || !authUser.id) return false;
    const permissions = await permissionsFor({ authenticated: true, id: authUser.id, email: authUser.email, name: authUser.name });
    return !!permissions.isAdmin;
}

function roomKeyForPresence(locationId, yearMonth) {
    return `presence:${locationId}:${yearMonth}`;
}

function roomKeyForDesks(locationId) {
    return `desks:${locationId}`;
}

function roomKeyForBooking(date, locationId) {
    // date expected: YYYY-MM-DD
    const [y, m] = date.split('-');
    return roomKeyForPresence(locationId, `${y}-${m}`);
}

function emitRoomDataChanged(io, roomKey, payload) {
    io.to(roomKey).emit('data:changed', { roomKey, ...payload });
}

/**
 * Initialize Socket.IO event handlers
 * @param {Server} io - Socket.IO server instance
 */
function initializeSocketHandlers(io) {
    io.on('connection', (socket) => {
        socket.data.user = null;
        socket.data.roomKey = null;
        socket.data.stateWindowStart = 0;
        socket.data.stateCount = 0;

        socket.on('presence:join', (payload) => {
            const { roomKey } = payload || {};
            if (!isValidRoomKey(roomKey)) return;
            const user = cleanPresenceUser(payload.user, socket.data.authUser);
            if (!user) return;
            if (!presenceRooms.has(roomKey) && presenceRooms.size >= MAX_ROOMS) return;

            // Joining the room we are already in changes nothing (and must not count twice)
            if (socket.data.roomKey === roomKey) return;

            // Leave previous room if switching
            if (socket.data.roomKey) leaveRoom(io, socket, { leaveSocketRoom: true });

            socket.data.user = user;
            socket.data.roomKey = roomKey;
            socket.join(roomKey);

            const room = ensurePresenceRoom(roomKey);
            const entry = room.get(user.id) || { user, sockets: new Map() };
            entry.sockets.set(socket, { mode: 'viewing', floor: null });
            room.set(user.id, entry);

            broadcastPresence(io, roomKey);
        });

        // Desks page only: say whether you are just looking or editing the layout, and on which floor
        socket.on('presence:state', async (payload) => {
            const roomKey = socket.data.roomKey;
            if (!roomKey || !DESK_ROOM_KEY.test(roomKey)) return;

            const now = Date.now();
            if (now - socket.data.stateWindowStart > STATE_WINDOW_MS) {
                socket.data.stateWindowStart = now;
                socket.data.stateCount = 0;
            }
            if (socket.data.stateCount >= STATE_MAX_PER_WINDOW) return;
            socket.data.stateCount += 1;

            const wanted = cleanDeskState(payload);
            try {
                if (wanted.mode === 'editing' && !(await mayEditLayout(socket))) wanted.mode = 'viewing';
            } catch (error) {
                wanted.mode = 'viewing';   // cannot tell: do not claim to be editing
            }

            // The connection may have moved on while the permission check ran
            if (socket.data.roomKey !== roomKey) return;
            const entry = presenceRooms.get(roomKey) && presenceRooms.get(roomKey).get(socket.data.user && socket.data.user.id);
            const current = entry && entry.sockets.get(socket);
            if (!current) return;

            current.mode = wanted.mode;
            current.floor = wanted.floor;
            broadcastPresence(io, roomKey);
        });

        socket.on('disconnect', () => {
            leaveRoom(io, socket, { leaveSocketRoom: false });
        });
    });
}

module.exports = {
    initializeSocketHandlers,
    cleanPresenceUser,
    cleanDeskState,
    roomKeyForBooking,
    roomKeyForPresence,
    roomKeyForDesks,
    emitRoomDataChanged
};
