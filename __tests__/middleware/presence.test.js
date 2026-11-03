/**
 * Presence: what the browser sends about a viewer is cleaned before everyone in the room sees it.
 */
const EventEmitter = require('events');

// The edit-permission check loads the database client, which the real module refuses to do without settings
jest.mock('../../config/supabase', () => ({ supabase: {} }));
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

describe('desks presence', () => {
    const ROOM = 'desks:jhb';
    const flush = () => new Promise(resolve => setImmediate(resolve));
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
        io.to = (room) => ({ emit: (event, payload) => io.emitted.push({ room, event, payload }) });
        return io;
    };
    let io;
    let clock;
    let sockets;
    const connect = (authUser) => {
        const socket = makeSocket(authUser);
        sockets.push(socket);
        io.emit('connection', socket);
        return socket;
    };
    const join = (socket, id, name, roomKey = ROOM) => socket.emit('presence:join', { roomKey, user: { id, name } });
    const state = async (socket, payload) => { clock += 1000; socket.emit('presence:state', payload); await flush(); };
    const lastViewers = () => io.emitted.filter(e => e.event === 'presence:update').pop().payload.viewers;

    beforeEach(() => {
        io = makeIo();
        sockets = [];
        initializeSocketHandlers(io);
        clock = 1000000;
        jest.spyOn(Date, 'now').mockImplementation(() => clock);
    });
    afterEach(() => {
        // Rooms are kept at module level, so empty them: nobody carries over into the next test
        sockets.forEach(socket => socket.emit('disconnect'));
        jest.restoreAllMocks();
    });

    test('joining the desks room lists the viewer as viewing, with no floor yet', () => {
        const jane = connect();
        join(jane, 'u1', 'Jane');
        expect(jane.join).toHaveBeenCalledWith(ROOM);
        expect(lastViewers()).toEqual([{ id: 'u1', name: 'Jane', color: '#6B7280', photo: '', mode: 'viewing', floor: null }]);
    });

    test.each(['desks:', 'desks:a b', 'desks:jhb"><img>', 'desks:' + 'x'.repeat(101), 'desk:jhb'])('a bad desks room key is ignored: %s', (roomKey) => {
        const socket = connect();
        join(socket, 'u1', 'Jane', roomKey);
        expect(socket.join).not.toHaveBeenCalled();
    });

    test('people see each other, and what each is doing', async () => {
        const jane = connect(); const sam = connect();
        join(jane, 'u1', 'Jane'); join(sam, 'u2', 'Sam');
        await state(jane, { mode: 'editing', floor: '2' });
        await state(sam, { mode: 'viewing', floor: '1' });
        expect(lastViewers().map(v => [v.name, v.mode, v.floor])).toEqual([['Jane', 'editing', '2'], ['Sam', 'viewing', '1']]);
    });

    test('a bad mode or floor falls back to viewing and no floor', async () => {
        const jane = connect();
        join(jane, 'u1', 'Jane');
        await state(jane, { mode: 'admin', floor: '1"><img src=x>' });
        expect(lastViewers()[0]).toMatchObject({ mode: 'viewing', floor: null });
        await state(jane, { mode: 'editing', floor: 3 });
        expect(lastViewers()[0]).toMatchObject({ mode: 'editing', floor: '3' });
        await state(jane, null);
        expect(lastViewers()[0]).toMatchObject({ mode: 'viewing', floor: null });
    });

    test('state changes are ignored outside a desks room, and before joining', async () => {
        const early = connect();
        await state(early, { mode: 'editing' });
        const calendar = connect();
        join(calendar, 'u1', 'Jane', 'presence:jhb:2026-03');
        const before = io.emitted.length;
        await state(calendar, { mode: 'editing' });
        expect(io.emitted).toHaveLength(before);
        expect(lastViewers()[0].mode).toBeUndefined();
    });

    test('one person with two tabs is listed once, and counts as editing while either tab is editing', async () => {
        const tab1 = connect(); const tab2 = connect();
        join(tab1, 'u1', 'Jane'); join(tab2, 'u1', 'Jane');
        expect(lastViewers()).toHaveLength(1);
        await state(tab1, { mode: 'editing', floor: '1' });
        await state(tab2, { mode: 'viewing', floor: '2' });
        expect(lastViewers()[0]).toMatchObject({ mode: 'editing', floor: '1' });
        tab1.emit('disconnect');
        expect(lastViewers()).toHaveLength(1);
        expect(lastViewers()[0]).toMatchObject({ mode: 'viewing', floor: '2' });
        // Closing the last tab removes the room: there is nobody left to tell
        tab2.emit('disconnect');
        const count = io.emitted.length;
        const newcomer = connect();
        join(newcomer, 'u9', 'Newcomer');
        expect(io.emitted).toHaveLength(count + 1);
        expect(lastViewers().map(v => v.name)).toEqual(['Newcomer']);
    });

    test('leaving tells the room, and moving to the calendar leaves the desks room', async () => {
        const jane = connect(); const sam = connect();
        join(jane, 'u1', 'Jane'); join(sam, 'u2', 'Sam');
        await state(jane, { mode: 'editing', floor: '1' });
        join(jane, 'u1', 'Jane', 'presence:jhb:2026-03');
        expect(jane.leave).toHaveBeenCalledWith(ROOM);
        const deskUpdate = io.emitted.filter(e => e.room === ROOM && e.event === 'presence:update').pop();
        expect(deskUpdate.payload.viewers.map(v => v.name)).toEqual(['Sam']);
        expect(io.emitted.filter(e => e.room === 'presence:jhb:2026-03').pop().payload.viewers.map(v => v.name)).toEqual(['Jane']);
    });

    test('a few quick changes in a row all count (opening the page, then starting to edit)', async () => {
        const jane = connect();
        join(jane, 'u1', 'Jane');
        jane.emit('presence:state', { mode: 'viewing', floor: '1' });
        jane.emit('presence:state', { mode: 'editing', floor: '1' });   // same instant
        await flush();
        expect(lastViewers()[0]).toMatchObject({ mode: 'editing', floor: '1' });
    });

    test('a flood of state changes is cut off, and allowed again after a while', async () => {
        const jane = connect();
        join(jane, 'u1', 'Jane');
        for (let i = 0; i < 10; i++) jane.emit('presence:state', { mode: 'viewing', floor: '1' });
        jane.emit('presence:state', { mode: 'editing', floor: '1' });   // the 11th within the window
        await flush();
        expect(lastViewers()[0]).toMatchObject({ mode: 'viewing' });
        clock += 6000;
        jane.emit('presence:state', { mode: 'editing', floor: '1' });
        await flush();
        expect(lastViewers()[0]).toMatchObject({ mode: 'editing' });
    });

    describe('who may edit (REQUIRE_AUTH=true)', () => {
        const permissions = require('../../utils/permissions');
        beforeEach(() => {
            jest.spyOn(permissions, 'enforced').mockReturnValue(true);
            jest.spyOn(permissions, 'permissionsFor').mockImplementation(async (user) => ({ isAdmin: user.email === 'admin@example.com' }));
        });

        test('an admin shows as editing', async () => {
            const admin = connect({ id: 'oid-a', email: 'admin@example.com', name: 'Admin' });
            join(admin, 'x', 'ignored');
            await state(admin, { mode: 'editing', floor: '1' });
            expect(lastViewers()[0]).toMatchObject({ id: 'oid-a', name: 'Admin', mode: 'editing' });
        });

        test('anyone else claiming to edit is shown as viewing', async () => {
            const staff = connect({ id: 'oid-s', email: 'staff@example.com', name: 'Staff' });
            join(staff, 'x', 'ignored');
            await state(staff, { mode: 'editing', floor: '1' });
            expect(lastViewers()[0]).toMatchObject({ id: 'oid-s', mode: 'viewing', floor: '1' });
        });

        test('if the permission check fails, they are shown as viewing', async () => {
            permissions.permissionsFor.mockRejectedValue(new Error('database down'));
            const admin = connect({ id: 'oid-a', email: 'admin@example.com', name: 'Admin' });
            join(admin, 'x', 'ignored');
            await state(admin, { mode: 'editing' });
            expect(lastViewers()[0].mode).toBe('viewing');
        });
    });
});
