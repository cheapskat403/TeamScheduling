/**
 * Presence: what the browser sends about a viewer is cleaned before everyone in the room sees it.
 */
const EventEmitter = require('events');
const { cleanPresenceUser, initializeSocketHandlers } = require('../../socket/presence');

describe('cleanPresenceUser', () => {
    test('keeps a normal viewer', () => {
        expect(cleanPresenceUser({ id: 'u1', name: 'Jane Doe', color: 'hsl(210, 70%, 50%)', photo: 'data:image/png;base64,iVBORw0KGgo=' }))
            .toEqual({ id: 'u1', name: 'Jane Doe', color: 'hsl(210, 70%, 50%)', photo: 'data:image/png;base64,iVBORw0KGgo=' });
    });

    test('accepts the negative hues the browser can produce, and hex colours', () => {
        expect(cleanPresenceUser({ id: 'u', name: 'A', color: 'hsl(-45, 70%, 50%)' }).color).toBe('hsl(-45, 70%, 50%)');
        expect(cleanPresenceUser({ id: 'u', name: 'A', color: '#3b82f6' }).color).toBe('#3b82f6');
    });

    test.each([
        'red" onmouseover="alert(1)" x="',
        'hsl(1, 2%, 3%); background:url(//evil.example/x)',
        'url(javascript:alert(1))',
        '<img src=x onerror=alert(1)>'
    ])('replaces a booby-trapped colour: %s', (color) => {
        expect(cleanPresenceUser({ id: 'u', name: 'A', color }).color).toBe('#6B7280');
    });

    test.each(['javascript:alert(1)', 'http://evil.example/x.png', 'https://a.example/x" onerror="alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='])(
        'drops a photo that is not a safe image: %s', (photo) => {
            expect(cleanPresenceUser({ id: 'u', name: 'A', photo }).photo).toBe('');
        });

    test('limits and cleans the name', () => {
        expect(cleanPresenceUser({ id: 'u', name: '  Jane\u0000 ' }).name).toBe('Jane');
        expect(cleanPresenceUser({ id: 'u', name: 'x'.repeat(101) }).name).toBe('Someone');
        expect(cleanPresenceUser({ id: 'u', name: { a: 1 } }).name).toBe('Someone');
    });

    test('refuses a viewer without a usable id', () => {
        [null, undefined, {}, { id: '' }, { id: {} }, { id: ['a'] }].forEach(user => expect(cleanPresenceUser(user)).toBeNull());
    });

    test('uses the logged-in identity instead of what the browser claims', () => {
        const result = cleanPresenceUser({ id: 'someone-else', name: 'The CEO' }, { id: 'real-oid', name: 'Real Person' });
        expect(result.id).toBe('real-oid');
        expect(result.name).toBe('Real Person');
    });
});

describe('presence:join', () => {
    const makeSocket = (authUser) => {
        const socket = new EventEmitter();
        socket.data = authUser ? { authUser } : {};
        socket.join = jest.fn();
        socket.leave = jest.fn();
        return socket;
    };
    const makeIo = () => {
        const io = new EventEmitter();
        io.emitted = [];
        io.to = () => ({ emit: (event, payload) => io.emitted.push({ event, payload }) });
        return io;
    };
    const connect = (authUser) => {
        const io = makeIo();
        initializeSocketHandlers(io);
        const socket = makeSocket(authUser);
        io.emit('connection', socket);
        return { io, socket };
    };

    test('a valid join is broadcast with the cleaned viewer', () => {
        const { io, socket } = connect();
        socket.emit('presence:join', { roomKey: 'presence:jhb:2026-03', user: { id: 'u1', name: 'Jane', color: 'red" x="' } });
        expect(socket.join).toHaveBeenCalledWith('presence:jhb:2026-03');
        const last = io.emitted[io.emitted.length - 1];
        expect(last.payload.viewers).toEqual([{ id: 'u1', name: 'Jane', color: '#6B7280', photo: '' }]);
    });

    test.each([undefined, null, '', 'x', 'presence:jhb', 'presence:jhb:2026-3', 'presence:a b:2026-03', 'presence:jhb:2026-03"><img>', 5, {}])(
        'a bad room key is ignored: %p', (roomKey) => {
            const { io, socket } = connect();
            socket.emit('presence:join', { roomKey, user: { id: 'u1', name: 'Jane' } });
            expect(socket.join).not.toHaveBeenCalled();
            expect(io.emitted).toHaveLength(0);
        });

    test('a join without a payload does not crash', () => {
        const { socket } = connect();
        expect(() => socket.emit('presence:join')).not.toThrow();
        expect(() => socket.emit('presence:join', null)).not.toThrow();
    });
});
