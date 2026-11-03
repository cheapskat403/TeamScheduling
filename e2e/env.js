/**
 * Where the browser tests get their database.
 *
 * They create a database called office_e2e on a PostgreSQL server, fill it with a few made-up desks and teams,
 * run the real app against it, and drop it afterwards. Point E2E_PG_ADMIN_URL at any server where that
 * login may create databases (the default is the throwaway server used during development).
 *
 * Because the tests DROP a database, they refuse to run against anything but this computer unless
 * E2E_ALLOW_REMOTE=1 is set on purpose. They can never touch your real data either way: the database name is fixed.
 */

const adminUrl = process.env.E2E_PG_ADMIN_URL || 'postgresql://postgres:localtest@localhost:54329/postgres';
const DB_NAME = 'office_e2e';
const PORT = 3210;

const host = new URL(adminUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && process.env.E2E_ALLOW_REMOTE !== '1') {
    throw new Error(`E2E_PG_ADMIN_URL points at "${host}". The browser tests drop and recreate a database, so they only run on this computer. Set E2E_ALLOW_REMOTE=1 if you really mean it.`);
}

function urlFor(dbName) {
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    return url.toString();
}

module.exports = { adminUrl, DB_NAME, PORT, dbUrl: urlFor(DB_NAME), baseURL: `http://localhost:${PORT}` };
