#!/usr/bin/env node
/**
 * Writes the SQL for the Supabase SQL editor into scripts/sql/ (does not touch any database):
 *   1-check.sql   read only: what exists now and what would be removed
 *   2-backup.sql  read only: one JSON value with everything that would be removed
 *   3-apply.sql   the change itself, as one all-or-nothing transaction
 *
 * The desks come from scripts/floor-plan-layout.js, the same layout the node script uses.
 *   node scripts/make-floor-plan-sql.js [--location=jhb]
 */
const fs = require('fs');
const path = require('path');
const { buildDesks, UNDERLAY } = require('./floor-plan-layout');

const LOCATION = (process.argv.find(a => a.startsWith('--location=')) || '--location=jhb').split('=')[1];
if (!/^[a-z0-9_-]+$/i.test(LOCATION)) throw new Error('location id may only contain letters, numbers, - and _');
const FLOOR = '1';
const desks = buildDesks({ location: LOCATION, floor: FLOOR });

const outDir = path.join(__dirname, 'sql');
fs.mkdirSync(outDir, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(outDir, name), text.replace(/\n/g, '\r\n'));

const DESKS_OF_LOCATION = `select id from desks where location_id = '${LOCATION}'`;

// ---------------------------------------------------------------- 1. check (read only)
write('1-check.sql', `-- 1 of 3: CHECK. Read only, changes nothing.
-- Run this first. It returns ONE row; read it before going any further.
--
--   location                 must say the office you expect (NULL = wrong project or wrong id)
--   desks / desks_by_floor   the desks that will be deleted
--   bookings                 desk bookings on those desks, which will be deleted with them
--   bookings_today_or_later  if this is not 0, make sure those bookings really are expendable
--   rooms_walls_labels       old floor plan shapes that will be deleted (see the note in 3-apply.sql)
--   floor_plan_settings      existing background drawings

select
  (select name from locations where id = '${LOCATION}')                                          as location,
  (select count(*) from desks where location_id = '${LOCATION}')                                 as desks,
  (select string_agg(floor || ': ' || n, ', ' order by floor)
     from (select floor, count(*) as n from desks where location_id = '${LOCATION}' group by floor) f) as desks_by_floor,
  (select count(*) from desk_bookings where desk_id in (${DESKS_OF_LOCATION}))                   as bookings,
  (select count(*) from desk_bookings where desk_id in (${DESKS_OF_LOCATION})
     and date >= (now() at time zone 'Africa/Johannesburg')::date)                               as bookings_today_or_later,
  (select count(*) from floor_elements where location_id = '${LOCATION}')                        as rooms_walls_labels,
  (select string_agg(key, ', ') from settings where key like 'floorplan_bg_%')                   as floor_plan_settings;
`);

// ---------------------------------------------------------------- 2. backup (read only)
write('2-backup.sql', `-- 2 of 3: BACKUP. Read only, changes nothing.
-- Returns ONE cell of JSON holding everything that step 3 deletes.
-- Click the cell, copy it, and save it in a file such as floor-plan-backup.json somewhere private.
-- It contains employee names and emails: do not commit it or share it.

select json_build_object(
  'takenAt',       now(),
  'location',      (select row_to_json(l) from locations l where l.id = '${LOCATION}'),
  'desks',         (select coalesce(json_agg(d), '[]'::json) from desks d where d.location_id = '${LOCATION}'),
  'deskBookings',  (select coalesce(json_agg(b), '[]'::json) from desk_bookings b where b.desk_id in (${DESKS_OF_LOCATION})),
  'floorElements', (select coalesce(json_agg(e), '[]'::json) from floor_elements e where e.location_id = '${LOCATION}'),
  'settings',      (select coalesce(json_agg(s), '[]'::json) from settings s where s.key like 'floorplan_bg_%')
) as backup;
`);

// ---------------------------------------------------------------- 3. apply
const sqlString = (v) => v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const rows = desks.map(d =>
    `  (${sqlString(d.id)}, ${sqlString(d.name)}, ${sqlString(d.location_id)}, ${sqlString(d.floor)}, ${sqlString(d.zone)}, ` +
    `${d.x}, ${d.y}, ${d.width}, ${d.height}, ${sqlString(d.desk_type)}, null, ` +
    `'${JSON.stringify(d.chair_positions)}'::jsonb, ` +
    `${sqlString(d.id + '-')} || substr(md5(random()::text || clock_timestamp()::text), 1, 8))`
).join(',\n');

write('3-apply.sql', `-- 3 of 3: APPLY. THIS DELETES DATA. Only run it after 1-check.sql looked right and you saved 2-backup.sql.
--
-- It runs as one transaction: if anything fails, or the final check below fails, nothing is changed.
-- Make sure the project name at the top of the Supabase dashboard is the one you mean.
--
-- What it does for location '${LOCATION}':
--   1. deletes every desk booking on its desks, then every desk (whatever floor name it has)
--   2. deletes its old rooms/walls/labels   <-- delete that one line below if you want to KEEP them
--   3. creates the ${desks.length} desks on floor ${FLOOR}
--   4. saves the floor ${FLOOR} background drawing (${UNDERLAY.url}) and sets the location to one floor
-- Other locations are never touched.

begin;

do $$
begin
  if not exists (select 1 from locations where id = '${LOCATION}') then
    raise exception 'Location ${LOCATION} was not found. Wrong project? Nothing was changed.';
  end if;
end $$;

delete from desk_bookings where desk_id in (${DESKS_OF_LOCATION});
delete from desks         where location_id = '${LOCATION}';
delete from floor_elements where location_id = '${LOCATION}';

insert into desks (id, name, location_id, floor, zone, x, y, width, height, desk_type, assigned_team_id, chair_positions, qr_code) values
${rows};

insert into settings (key, value)
values ('floorplan_bg_${LOCATION}_${FLOOR}', '${JSON.stringify(UNDERLAY)}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

delete from settings where key like 'floorplan_bg_${LOCATION}_%' and key <> 'floorplan_bg_${LOCATION}_${FLOOR}';

update locations set floors = 1 where id = '${LOCATION}';

-- Final check: if this fails, the whole transaction is rolled back
do $$
declare
  n_desks int;
  n_off_floor int;
  n_names int;
begin
  select count(*) into n_desks     from desks where location_id = '${LOCATION}';
  select count(*) into n_off_floor from desks where location_id = '${LOCATION}' and floor <> '${FLOOR}';
  select count(distinct name) into n_names from desks where location_id = '${LOCATION}';
  if n_desks <> ${desks.length} or n_off_floor <> 0 or n_names <> ${desks.length} then
    raise exception 'Final check failed (% desks, % off floor ${FLOOR}, % distinct names). Nothing was changed.', n_desks, n_off_floor, n_names;
  end if;
end $$;

commit;

-- Afterwards, run 1-check.sql again: it should show ${desks.length} desks, "${FLOOR}: ${desks.length}", 0 bookings, 0 rooms_walls_labels
-- and floor_plan_settings = floorplan_bg_${LOCATION}_${FLOOR}.
`);

console.log(`Wrote ${['1-check.sql', '2-backup.sql', '3-apply.sql'].map(n => 'scripts/sql/' + n).join(', ')} for location "${LOCATION}" (${desks.length} desks)`);
