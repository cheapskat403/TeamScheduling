#!/usr/bin/env node
/**
 * Replace a location's desk data with the floor plan layout.
 *
 *   DRY RUN (default, changes nothing):
 *     node scripts/setup-floor-plan.js
 *
 *   APPLY (needs the project ref typed back as confirmation):
 *     node scripts/setup-floor-plan.js --apply --confirm=<project-ref>
 *
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from the environment. It does NOT read .env on its own,
 * so a stray local .env can't point it at the wrong database. Use `node -r dotenv/config ...` for that.
 *
 * What --apply does, for the chosen location (default "jhb"):
 *   1. writes a JSON snapshot of everything it is about to delete to ./backups/
 *   2. deletes ALL desk bookings on that location's desks, then ALL of its desks (any floor name)
 *   3. deletes its floor elements (rooms/walls/labels), unless --keep-rooms
 *   4. creates the layout's desks on floor 1
 *   5. saves the floor 1 background drawing setting and sets the location to a single floor
 *
 * Other locations are never touched.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { buildDesks, UNDERLAY } = require('./floor-plan-layout');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const LOCATION = option('location', 'jhb');
const FLOOR = '1';
const APPLY = flag('apply');
const KEEP_ROOMS = flag('keep-rooms');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || '';
if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment first.');
    process.exit(1);
}
const projectRef = (url.match(/^https?:\/\/([^.]+)\./) || [])[1] || url;
const db = createClient(url, key);

const chunk = (arr, n = 100) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const must = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`); };
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());

async function readAll(table, filter) {
    // Page through results so large tables are not cut off at the default limit
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await filter(db.from(table).select('*')).range(from, from + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...data);
        if (data.length < 1000) return rows;
    }
}

(async () => {
    console.log(`\nProject: ${projectRef}   Location: ${LOCATION}   Mode: ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be changed)'}\n`);

    const { data: location, error: locError } = await db.from('locations').select('*').eq('id', LOCATION).single();
    if (locError || !location) throw new Error(`Location "${LOCATION}" not found in this project`);

    const desks = await readAll('desks', q => q.eq('location_id', LOCATION));
    const deskIds = desks.map(d => d.id);
    let bookings = [];
    for (const ids of chunk(deskIds)) bookings.push(...await readAll('desk_bookings', q => q.in('desk_id', ids)));
    const elements = await readAll('floor_elements', q => q.eq('location_id', LOCATION));
    const { data: settings } = await db.from('settings').select('*').like('key', `floorplan_bg_${LOCATION}_%`);
    const newDesks = buildDesks({ location: LOCATION, floor: FLOOR });

    // ---- report ----
    console.log(`Location: ${location.name} (${location.floors} floor${location.floors === 1 ? '' : 's'} recorded)`);
    const floors = [...new Set(desks.map(d => d.floor))];
    floors.forEach(f => {
        const ids = new Set(desks.filter(d => d.floor === f).map(d => d.id));
        const fb = bookings.filter(b => ids.has(b.desk_id));
        console.log(`  floor "${f}": ${ids.size} desks, ${fb.length} bookings`);
    });
    if (!floors.length) console.log('  (no desks at all)');
    const today = todayStr();
    const upcoming = bookings.filter(b => b.date >= today);
    console.log(`\nWill DELETE: ${bookings.length} desk bookings, ${desks.length} desks, ${KEEP_ROOMS ? 0 : elements.length} floor elements${KEEP_ROOMS ? ` (keeping ${elements.length} because of --keep-rooms)` : ''}`);
    if (upcoming.length) {
        console.log(`  !! ${upcoming.length} of those bookings are for today or later (${upcoming.slice(0, 5).map(b => `${b.employee_name} ${b.date}`).join(', ')}${upcoming.length > 5 ? ', ...' : ''})`);
    }
    console.log(`Will CREATE: ${newDesks.length} desks on floor ${FLOOR} (${[...new Set(newDesks.map(d => d.zone))].join(', ')})`);
    console.log(`Will SET:    floorplan_bg_${LOCATION}_${FLOOR} -> ${UNDERLAY.url}, location floors -> 1`);
    const oldSettingKeys = settings.map(s => s.key).filter(k => k !== `floorplan_bg_${LOCATION}_${FLOOR}`);
    if (oldSettingKeys.length) console.log(`Will REMOVE: leftover background settings ${oldSettingKeys.join(', ')}`);

    if (!APPLY) {
        console.log('\nDry run only. To apply:  node scripts/setup-floor-plan.js --apply --confirm=' + projectRef + '\n');
        return;
    }

    if (option('confirm') !== projectRef) {
        throw new Error(`Refusing to apply: add --confirm=${projectRef} to confirm this is the project you mean.`);
    }

    // ---- 1. snapshot ----
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `floor-plan-${projectRef}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), projectRef, location, desks, deskBookings: bookings, floorElements: elements, settings }, null, 2));
    console.log(`\nSnapshot saved: ${file}`);

    // ---- 2-3. delete ----
    for (const ids of chunk(deskIds)) must('delete bookings', await db.from('desk_bookings').delete().in('desk_id', ids));
    for (const ids of chunk(deskIds)) must('delete desks', await db.from('desks').delete().in('id', ids));
    if (!KEEP_ROOMS) for (const ids of chunk(elements.map(e => e.id))) must('delete floor elements', await db.from('floor_elements').delete().in('id', ids));

    // ---- 4-5. create ----
    must('create desks', await db.from('desks').insert(newDesks));
    must('save background', await db.from('settings').upsert({ key: `floorplan_bg_${LOCATION}_${FLOOR}`, value: UNDERLAY }, { onConflict: 'key' }));
    if (oldSettingKeys.length) must('remove old backgrounds', await db.from('settings').delete().in('key', oldSettingKeys));
    must('set floors', await db.from('locations').update({ floors: 1 }).eq('id', LOCATION));

    // ---- verify ----
    const after = await readAll('desks', q => q.eq('location_id', LOCATION));
    const wrong = after.filter(d => d.floor !== FLOOR);
    console.log(`\nDone. ${after.length} desks now exist for ${LOCATION}${wrong.length ? `, BUT ${wrong.length} are not on floor ${FLOOR}` : ', all on floor ' + FLOOR}.`);
    if (after.length !== newDesks.length || wrong.length) process.exitCode = 1;
})().catch(e => { console.error('\nFAILED:', e.message || e); process.exit(1); });
