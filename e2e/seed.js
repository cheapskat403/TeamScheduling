/**
 * The made-up office the browser tests run against: one location, three teams, a few desks.
 * Ids are fixed so tests can refer to them (the desk element for A01 is #desk-e2e-a01).
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { adminUrl, DB_NAME, dbUrl } = require('./env');

const LOCATION = 'e2e-office';

async function createDatabase() {
    // Refuse anything but the fixed test name: this is the only database these tests may drop
    if (DB_NAME !== 'office_e2e') throw new Error('Unexpected test database name');

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${DB_NAME}`);
    } finally {
        await admin.end();
    }

    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
        await db.query(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'postgres', '1-create-schema.sql'), 'utf8'));
        await seed(db);
    } finally {
        await db.end();
    }
}

async function dropDatabase() {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    } finally {
        await admin.end();
    }
}

async function seed(db) {
    await db.query(`INSERT INTO locations (id, name, address, capacity, floors) VALUES ($1, 'Test Office', '1 Test Street', 21, 1)`, [LOCATION]);

    const teams = [
        ['e2e-alpha', 'Alpha Team', '#2563eb', 3],
        ['e2e-bravo', 'Bravo Team', '#16a34a', 2],
        ['e2e-charlie', 'Charlie Team', '#dc2626', 4]
    ];
    for (const [id, name, color, members] of teams) {
        await db.query(`INSERT INTO teams (id, name, manager, color, member_count, location_id) VALUES ($1, $2, 'Test Manager', $3, $4, $5)`, [id, name, color, members, LOCATION]);
    }

    // A01-A06 are ordinary desks, T01 is reserved for Alpha, X01 is unavailable
    const desks = [
        ['a01', 'A01', 'hotseat'], ['a02', 'A02', 'hotseat'], ['a03', 'A03', 'hotseat'],
        ['a04', 'A04', 'hotseat'], ['a05', 'A05', 'hotseat'], ['a06', 'A06', 'hotseat'],
        ['t01', 'T01', 'team_seat'], ['x01', 'X01', 'unavailable']
    ];
    for (const [index, [key, name, type]] of desks.entries()) {
        await db.query(
            `INSERT INTO desks (id, name, location_id, floor, x, y, width, height, desk_type, assigned_team_id, chair_positions, qr_code)
             VALUES ($1, $2, $3, '1', $4, $5, 60, 40, $6, $7, '["bottom"]'::jsonb, $8)`,
            [`e2e-${key}`, name, LOCATION, 40 + (index % 4) * 90, 40 + Math.floor(index / 4) * 90, type, type === 'team_seat' ? 'e2e-alpha' : null, `QR-${key}`]
        );
    }

    await db.query(`INSERT INTO settings (key, value) VALUES ('team_roles', '["Senior Manager"]'::jsonb)`);
}

/** Puts back everything tests change, so each test starts from the same office */
async function resetData() {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
        await db.query(`DELETE FROM audit_log`);
        await db.query(`DELETE FROM desk_bookings`);
        await db.query(`DELETE FROM bookings`);
        await db.query(`DELETE FROM settings WHERE key IN ('admin_emails', 'audit_viewer_roles')`);
        await db.query(`UPDATE settings SET value = '["Senior Manager"]'::jsonb WHERE key = 'team_roles'`);
    } finally {
        await db.end();
    }
}

module.exports = { createDatabase, dropDatabase, resetData, LOCATION };
