/**
 * Socket.IO presence management
 * Tracks which users are viewing which rooms (location + month combinations)
 */

const { checks, ValidationError } = require('../utils/validate');

const ROOM_KEY = /^presence:[A-Za-z0-9_-]{1,100}:\d{4}-(?:0[1-9]|1[0-2])$/;
const HSL_COLOR = /^hsl\(-?\d{1,3}, \d{1,3}%, \d{1,3}%\)$/;
const MAX_ROOMS = 500;
const MAX_USER_ID = 100;

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

// Presence: roomKey -> Map(userId -> { user: {id,name,color}, connections: number })
const presenceRooms = new Map();

function ensurePresenceRoom(roomKey) {
    if (!presenceRooms.has(roomKey)) presenceRooms.set(roomKey, new Map());
    return presenceRooms.get(roomKey);
}

function broadcastPresence(io, roomKey) {
    const room = presenceRooms.get(roomKey);
    if (!room) return;
    const viewers = Array.from(room.values()).map(v => v.user);
    io.to(roomKey).emit('presence:update', { roomKey, viewers });
}

function roomKeyForPresence(locationId, yearMonth) {
    return `presence:${locationId}:${yearMonth}`;
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

        socket.on('presence:join', (payload) => {
            const { roomKey } = payload || {};
            if (typeof roomKey !== 'string' || !ROOM_KEY.test(roomKey)) return;
            const user = cleanPresenceUser(payload.user, socket.data.authUser);
            if (!user) return;
            if (!presenceRooms.has(roomKey) && presenceRooms.size >= MAX_ROOMS) return;

            // Joining the room we are already in changes nothing (and must not count twice)
            if (socket.data.roomKey === roomKey) return;

            // Leave previous room if switching
            if (socket.data.roomKey && socket.data.roomKey !== roomKey) {
                socket.leave(socket.data.roomKey);
                const prevRoom = presenceRooms.get(socket.data.roomKey);
                if (prevRoom) {
                    const prevEntry = prevRoom.get(socket.data.user?.id);
                    if (prevEntry) {
                        prevEntry.connections -= 1;
                        if (prevEntry.connections <= 0) prevRoom.delete(socket.data.user.id);
                    }
                    if (prevRoom.size === 0) presenceRooms.delete(socket.data.roomKey);
                }
                broadcastPresence(io, socket.data.roomKey);
            }

            socket.data.user = user;
            socket.data.roomKey = roomKey;
            socket.join(roomKey);

            const room = ensurePresenceRoom(roomKey);
            const entry = room.get(user.id);
            if (entry) entry.connections += 1;
            else room.set(user.id, { user, connections: 1 });

            broadcastPresence(io, roomKey);
        });

        socket.on('disconnect', () => {
            const roomKey = socket.data.roomKey;
            const userId = socket.data.user?.id;
            if (!roomKey || !userId) return;

            const room = presenceRooms.get(roomKey);
            if (!room) return;

            const entry = room.get(userId);
            if (entry) {
                entry.connections -= 1;
                if (entry.connections <= 0) room.delete(userId);
            }
            if (room.size === 0) presenceRooms.delete(roomKey);
            broadcastPresence(io, roomKey);
        });
    });
}

module.exports = {
    initializeSocketHandlers,
    cleanPresenceUser,
    roomKeyForBooking,
    roomKeyForPresence,
    emitRoomDataChanged
};

