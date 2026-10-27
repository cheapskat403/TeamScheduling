/**
 * socketAuth: with REQUIRE_AUTH=true a websocket only connects with a valid token.
 */
// jwks-rsa 4 pulls in an ESM-only package Jest cannot parse; token checking is replaced in these tests anyway
jest.mock('jwks-rsa', () => jest.fn());

const { socketAuth } = require('../../middleware/socketAuth');

describe('socketAuth', () => {
    const makeSocket = (auth) => ({ handshake: auth === undefined ? {} : { auth }, data: {} });
    const claims = { oid: 'user-1', email: 'jane@example.com', name: 'Jane Doe' };

    const run = async (middleware, socket) => {
        const next = jest.fn();
        await middleware(socket, next);
        return next;
    };

    test('lets everyone connect when login is not required', async () => {
        const verify = jest.fn();
        const next = await run(socketAuth({ isRequired: () => false, verify }), makeSocket({}));
        expect(next).toHaveBeenCalledWith();
        expect(verify).not.toHaveBeenCalled();
    });

    test('refuses a connection with no token', async () => {
        const verify = jest.fn();
        const mw = socketAuth({ isRequired: () => true, verify });
        for (const socket of [makeSocket({}), makeSocket({ token: '' }), makeSocket({ token: null }), makeSocket(undefined), { data: {} }]) {
            const next = await run(mw, socket);
            expect(next).toHaveBeenCalledTimes(1);
            expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
            expect(next.mock.calls[0][0].message).toBe('AUTH_REQUIRED');
        }
        expect(verify).not.toHaveBeenCalled();
    });

    test('refuses a token that does not verify', async () => {
        const verify = jest.fn().mockRejectedValue(new Error('jwt expired'));
        const socket = makeSocket({ token: 'stale' });
        const next = await run(socketAuth({ isRequired: () => true, verify }), socket);
        expect(verify).toHaveBeenCalledWith('stale');
        expect(next.mock.calls[0][0].message).toBe('AUTH_INVALID');
        expect(socket.data.authUser).toBeUndefined();
    });

    test('accepts a valid token and records who it is', async () => {
        const verify = jest.fn().mockResolvedValue(claims);
        const socket = makeSocket({ token: 'good' });
        const next = await run(socketAuth({ isRequired: () => true, verify }), socket);
        expect(next).toHaveBeenCalledWith();
        expect(socket.data.authUser).toEqual({ id: 'user-1', email: 'jane@example.com', name: 'Jane Doe' });
    });

    test('falls back to sub and preferred_username when oid / email are missing', async () => {
        const verify = jest.fn().mockResolvedValue({ sub: 'subject-9', preferred_username: 'bob@example.com', name: 'Bob' });
        const socket = makeSocket({ token: 'good' });
        await run(socketAuth({ isRequired: () => true, verify }), socket);
        expect(socket.data.authUser).toEqual({ id: 'subject-9', email: 'bob@example.com', name: 'Bob' });
    });

    test('REQUIRE_AUTH is read on every connection', async () => {
        const saved = process.env.REQUIRE_AUTH;
        const verify = jest.fn().mockResolvedValue(claims);
        const mw = socketAuth({ verify });
        try {
            process.env.REQUIRE_AUTH = 'true';
            expect((await run(mw, makeSocket({}))).mock.calls[0][0]).toBeInstanceOf(Error);
            process.env.REQUIRE_AUTH = 'false';
            expect(await run(mw, makeSocket({}))).toHaveBeenCalledWith();
        } finally {
            if (saved === undefined) delete process.env.REQUIRE_AUTH;
            else process.env.REQUIRE_AUTH = saved;
        }
    });
});
