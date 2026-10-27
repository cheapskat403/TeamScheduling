/**
 * Socket.IO authentication
 *
 * When REQUIRE_AUTH=true a websocket can only connect with a valid Azure AD token, sent as
 * io({ auth: { token } }). Without this the live presence feed (who is online, with names and
 * photos) would be open to anyone who can reach the server.
 *
 * The token is checked when the connection is made, like a login. An already open connection
 * stays open after the token expires; the client reconnects with a fresh token when needed.
 */
const { verifyToken } = require('./auth');
const logger = require('../utils/logger');

/**
 * @param {object} [options]
 * @param {() => boolean} [options.isRequired] read on every connection, so it can be changed in tests
 * @param {(token: string) => Promise<object>} [options.verify] token check, replaceable in tests
 */
function socketAuth({ isRequired = () => process.env.REQUIRE_AUTH === 'true', verify = verifyToken } = {}) {
    return async (socket, next) => {
        if (!isRequired()) return next();

        const token = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error('AUTH_REQUIRED'));

        try {
            const claims = await verify(token);
            socket.data.authUser = {
                id: claims.oid || claims.sub,
                email: claims.email || claims.preferred_username || claims.upn,
                name: claims.name
            };
            return next();
        } catch (err) {
            logger.warn('Socket token rejected:', err.message);
            return next(new Error('AUTH_INVALID'));
        }
    };
}

module.exports = { socketAuth };
