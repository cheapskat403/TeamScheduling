-- 2 of 3: BACKUP. Read only, changes nothing.
-- Returns ONE cell of JSON holding everything that step 3 deletes.
-- Click the cell, copy it, and save it in a file such as floor-plan-backup.json somewhere private.
-- It contains employee names and emails: do not commit it or share it.

select json_build_object(
  'takenAt',       now(),
  'location',      (select row_to_json(l) from locations l where l.id = 'jhb'),
  'desks',         (select coalesce(json_agg(d), '[]'::json) from desks d where d.location_id = 'jhb'),
  'deskBookings',  (select coalesce(json_agg(b), '[]'::json) from desk_bookings b where b.desk_id in (select id from desks where location_id = 'jhb')),
  'floorElements', (select coalesce(json_agg(e), '[]'::json) from floor_elements e where e.location_id = 'jhb'),
  'settings',      (select coalesce(json_agg(s), '[]'::json) from settings s where s.key like 'floorplan_bg_%')
) as backup;
