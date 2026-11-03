/**
 * Direct PostgreSQL connection (used when DB_PROVIDER=postgres, see config/supabase.js).
 *
 * Connect with DATABASE_URL, or with DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD.
 * DB_SSL: "require" (default, verifies the server certificate), "no-verify" (encrypts but does not
 * verify, for self-signed certificates) or "disable" (local development only).
 */

const { Pool, types } = require('pg');
const logger = require('../utils/logger');
const { PostgresClient } = require('../utils/pgQueryBuilder');

// Return the same shapes Supabase does: DATE as 'YYYY-MM-DD' text, timestamps as ISO text (a Date object
// would be flattened to {} by toCamelCase), bigint and numeric as numbers.
types.setTypeParser(1082, value => value);
types.setTypeParser(1184, value => new Date(value).toISOString());
types.setTypeParser(1114, value => new Date(`${value}Z`).toISOString());
types.setTypeParser(20, value => Number(value));
types.setTypeParser(1700, value => Number(value));

function sslOption() {
    const mode = (process.env.DB_SSL || 'require').toLowerCase();
    if (mode === 'disable') return false;
    if (mode === 'no-verify') return { rejectUnauthorized: false };
    return { rejectUnauthorized: true };
}

function poolConfig() {
    const common = {
        max: parseInt(process.env.DB_POOL_MAX || '10', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: sslOption()
    };

    if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ...common };

    const { DB_HOST, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
    if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
        console.error('Missing PostgreSQL configuration!');
        console.error('Set DATABASE_URL, or DB_HOST, DB_NAME, DB_USER and DB_PASSWORD (DB_PORT optional).');
        process.exit(1);
    }
    return { host: DB_HOST, port: parseInt(process.env.DB_PORT || '5432', 10), database: DB_NAME, user: DB_USER, password: DB_PASSWORD, ...common };
}

const pool = new Pool(poolConfig());

// An idle client dropping (a restart or failover on the server) must not take the app down.
pool.on('error', error => logger.error('PostgreSQL idle client error:', error.message));

pool.query('SELECT 1').then(
    () => logger.info('Connected to PostgreSQL'),
    error => logger.error('Could not connect to PostgreSQL:', error.message)
);

module.exports = { pool, supabase: new PostgresClient(pool) };
