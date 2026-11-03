/**
 * Copy the app's data from Supabase to a PostgreSQL server (e.g. Azure Database for PostgreSQL).
 *
 * It only READS from Supabase. All writes go to the target, inside one transaction: if any table fails
 * or the row/key comparison at the end does not match, nothing is kept.
 *
 *   SOURCE (Supabase):  SUPABASE_URL, SUPABASE_SECRET_KEY
 *   TARGET (Postgres):  DATABASE_URL, or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD (+ DB_PORT, DB_SSL)
 *
 *   node scripts/migrate-supabase-to-postgres.js --dry-run      read the source, check the target, write nothing
 *   node scripts/migrate-supabase-to-postgres.js --schema-only  create the tables on the target, copy no data
 *   node scripts/migrate-supabase-to-postgres.js                create tables if missing and copy; refuses when
 *                                                               the target already holds data
 *   node scripts/migrate-supabase-to-postgres.js --replace      same, but empties the target tables first
 *   node scripts/migrate-supabase-to-postgres.js --export-sql=data.sql
 *                                                               no target needed: read Supabase and write a SQL file
 *                                                               of the data, to run by hand on any machine that can
 *                                                               reach the database (see POSTGRESQL-MIGRATION.md)
 *
 * Secrets are never printed. Only the target host and database name are shown so you can check them.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parents before children so foreign keys are satisfied.
const TABLES = [
    { name: 'locations', key: 'id' },
    { name: 'teams', key: 'id' },
    { name: 'bookings', key: 'id' },
    { name: 'public_holidays', key: 'id' },
    { name: 'desks', key: 'id' },
    { name: 'desk_bookings', key: 'id' },
    { name: 'floor_elements', key: 'id' },
    { name: 'settings', key: 'key' }
];
const JSONB_COLUMNS = { desks: ['chair_positions'], floor_elements: ['points'], settings: ['value'] };
const PAGE = 1000;
const MAX_PARAMS = 60000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SCHEMA_ONLY = args.has('--schema-only');
const REPLACE = args.has('--replace');
const EXPORT_FILE = (process.argv.find(a => a.startsWith('--export-sql=')) || '').slice('--export-sql='.length);

const fail = message => { console.error(`\nERROR: ${message}`); process.exit(1); };
const NL = String.fromCharCode(10);
const q = name =>`"${name.replace(/"/g, '""')}"`;

async function readSource(supabase, table) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from(table.name).select('*').order(table.key).range(from, from + PAGE - 1);
        if (error) fail(`Could not read ${table.name} from Supabase: ${error.message}`);
        rows.push(...data);
        if (data.length < PAGE) return rows;
    }
}

function toParam(table, column, value) {
    if ((JSONB_COLUMNS[table] || []).includes(column) && value !== null && value !== undefined) return JSON.stringify(value);
    return value;
}

async function insertRows(client, table, rows) {
    if (rows.length === 0) return;
    const columns = Object.keys(rows[0]);
    const perChunk = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
    for (let i = 0; i < rows.length; i += perChunk) {
        const chunk = rows.slice(i, i + perChunk);
        const params = [];
        const tuples = chunk.map(row => `(${columns.map(c => { params.push(toParam(table, c, row[c])); return `$${params.length}`; }).join(', ')})`);
        await client.query(`INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES ${tuples.join(', ')}`, params);
    }
}

function literal(table, column, value) {
    if (value === null || value === undefined) return 'NULL';
    if ((JSONB_COLUMNS[table] || []).includes(column)) return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
}

// Writes the data as a plain SQL script: one transaction, parents first, then a count of every table.
async function exportSql(supabase, file) {
    const out = ['-- Data export from Supabase. Run scripts/postgres/1-create-schema.sql first, then this file, on an EMPTY database.',
        `-- Created ${new Date().toISOString()} from ${process.env.SUPABASE_URL.replace('https://', '')}`, '', 'BEGIN;', ''];
    const expected = [];
    console.log('Reading from Supabase...');
    for (const table of TABLES) {
        const rows = await readSource(supabase, table);
        console.log(`  ${table.name.padEnd(16)} ${rows.length} rows`);
        expected.push(`${table.name} ${rows.length}`);
        if (rows.length === 0) continue;
        const columns = Object.keys(rows[0]);
        for (let i = 0; i < rows.length; i += 200) {
            const tuples = rows.slice(i, i + 200).map(r => `  (${columns.map(c => literal(table.name, c, r[c])).join(', ')})`);
            out.push(`INSERT INTO ${q(table.name)} (${columns.map(q).join(', ')}) VALUES${NL}${tuples.join(',' + NL)};`, '');
        }
    }
    out.push("SELECT setval(pg_get_serial_sequence('public_holidays', 'id'), COALESCE((SELECT MAX(id) FROM public_holidays), 0) + 1, false);", '',
        `-- Row counts that should come out below: ${expected.join(', ')}`,
        TABLES.map(t => `SELECT '${t.name}' AS table_name, COUNT(*) AS rows FROM ${q(t.name)}`).join(NL + 'UNION ALL ') + NL + 'ORDER BY 1;', '', 'COMMIT;', '');
    fs.writeFileSync(file, out.join(NL), 'utf8');
    console.log(`${NL}Wrote ${file}. It contains your data: keep it private and delete it when you are done.`);
}

async function main() {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
    if ((EXPORT_FILE || !SCHEMA_ONLY) && (!SUPABASE_URL || !SUPABASE_SECRET_KEY)) fail('Set SUPABASE_URL and SUPABASE_SECRET_KEY for the source.');

    if (EXPORT_FILE) return exportSql(createClient(SUPABASE_URL, SUPABASE_SECRET_KEY), EXPORT_FILE);

    const { pool } = require('../config/postgres');
    const target = await pool.query('SELECT current_database() AS db');
    console.log(`Target database: ${target.rows[0].db}  (host: ${process.env.DB_HOST || 'from DATABASE_URL'})`);
    if (SUPABASE_URL) console.log(`Source project:  ${SUPABASE_URL.replace(/^https?:\/\//, '')}`);
    console.log(DRY_RUN ? 'Mode: DRY RUN, nothing will be written\n' : '');

    const schemaSql = fs.readFileSync(path.join(__dirname, 'postgres', '1-create-schema.sql'), 'utf8');

    if (SCHEMA_ONLY) {
        if (DRY_RUN) { console.log('Would create the tables from scripts/postgres/1-create-schema.sql.'); return pool.end(); }
        await pool.query(schemaSql);
        console.log('Tables created (existing tables were left alone).');
        return pool.end();
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const source = {};
    console.log('Reading from Supabase...');
    for (const table of TABLES) {
        source[table.name] = await readSource(supabase, table);
        console.log(`  ${table.name.padEnd(16)} ${source[table.name].length} rows`);
    }

    // What is already on the target?
    const existing = {};
    const present = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map(r => r.table_name);
    for (const table of TABLES) {
        existing[table.name] = present.includes(table.name)
            ? (await pool.query(`SELECT COUNT(*)::int AS n FROM ${q(table.name)}`)).rows[0].n
            : null;
    }
    console.log('\nOn the target now:');
    TABLES.forEach(t => console.log(`  ${t.name.padEnd(16)} ${existing[t.name] === null ? 'table missing' : existing[t.name] + ' rows'}`));

    const hasData = Object.values(existing).some(n => n > 0);
    if (hasData && !REPLACE) fail('The target already contains data. Run with --replace to empty its tables first, or use an empty database.');

    if (DRY_RUN) {
        console.log(`\nDry run finished. A real run would ${hasData ? 'EMPTY the target tables, then ' : ''}copy the rows above.`);
        return pool.end();
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(schemaSql);
        if (REPLACE) {
            await client.query(`TRUNCATE ${TABLES.map(t => q(t.name)).join(', ')} RESTART IDENTITY CASCADE`);
        }
        for (const table of TABLES) {
            await insertRows(client, table.name, source[table.name]);
        }
        // The holidays id is a serial column that was filled explicitly, so move its sequence past the copied ids.
        await client.query("SELECT setval(pg_get_serial_sequence('public_holidays', 'id'), COALESCE((SELECT MAX(id) FROM public_holidays), 0) + 1, false)");

        console.log('\nChecking the copy...');
        let ok = true;
        for (const table of TABLES) {
            const copied = (await client.query(`SELECT ${q(table.key)} AS k FROM ${q(table.name)}`)).rows.map(r => String(r.k));
            const expected = source[table.name].map(r => String(r[table.key]));
            const copiedSet = new Set(copied);
            const same = copied.length === expected.length && copiedSet.size === copied.length && expected.every(k => copiedSet.has(k));
            console.log(`  ${table.name.padEnd(16)} source ${expected.length}  target ${copied.length}  ${same ? 'OK' : 'MISMATCH'}`);
            ok = ok && same;
        }
        if (!ok) throw new Error('The copy does not match the source.');

        await client.query('COMMIT');
        console.log('\nDone. The data was copied and verified.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`\nRolled back, the target is unchanged: ${error.message}`);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => fail(error.message));
