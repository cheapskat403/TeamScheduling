/**
 * Cases found in review: floor names, line breaks, apostrophes in emails, presence re-joins.
 */
const EventEmitter = require('events');
const { checks, ValidationError } = require('../../utils/validate');
const { initializeSocketHandlers } = require('../../socket/presence');

describe('floor names', () => {
    test.each(['1', '2', 'Ground', 'Mezzanine 2', 'B-1', ''])('accepts %p', (v) => expect(checks.floor(v, 'floor')).toBe(v));
    test.each(['<svg/onload=alert``>', 'a"b', "a'b", 'x'.repeat(21), 5, null])('refuses %p', (v) => {
        expect(() => checks.floor(v, 'floor')).toThrow(ValidationError);
    });
});

describe('line breaks', () => {
    test('single-line fields turn line breaks into a space', () => {
        expect(checks.str(50)('line1\nline2\ttab', 'name')).toBe('line1 line2 tab');
    });
    test('multi-line fields (notes) keep them', () => {
        expect(checks.str(50, { multiline: true })('line1\r\nline2\nline3', 'notes')).toBe('line1\nline2\nline3');
        expect(checks.str(50, { multiline: true })('a\u0000b', 'notes')).toBe('ab');
    });
});

describe('email', () => {
    test('allows an apostrophe in the name part only', () => {
        expect(checks.email("o'brien@corp.com", 'e')).toBe("o'brien@corp.com");
        expect(() => checks.email("a@co'rp.com", 'e')).toThrow(ValidationError);
    });
});

describe('presence re-join', () => {
    const connect = () => {
        const io = new EventEmitter();
        io.emitted = [];
        io.to = () => ({ emit: (event, payload) => io.emitted.push({ event, payload }) });
        initializeSocketHandlers(io);
        const socket = new EventEmitter();
        socket.data = {};
        socket.join = jest.fn();
        socket.leave = jest.fn();
        io.emit('connection', socket);
        return { io, socket };
    };

    test('joining the same room twice leaves nobody behind after disconnect', () => {
        const { io, socket } = connect();
        const join = () => socket.emit('presence:join', { roomKey: 'presence:rejoin:2026-03', user: { id: 'u1', name: 'Jane' } });
        join(); join();
        socket.emit('disconnect');
        // a new connection sees an empty room
        const second = connect();
        second.socket.emit('presence:join', { roomKey: 'presence:rejoin:2026-03', user: { id: 'u2', name: 'Other' } });
        const seen = second.io.emitted[second.io.emitted.length - 1].payload.viewers.map(v => v.id);
        expect(seen).toEqual(['u2']);
    });

    test.each(['presence:x:2026-00', 'presence:x:2026-13', 'presence:x:2026-99'])('refuses a month that does not exist: %s', (roomKey) => {
        const { socket } = connect();
        socket.emit('presence:join', { roomKey, user: { id: 'u1', name: 'Jane' } });
        expect(socket.join).not.toHaveBeenCalled();
    });
});
