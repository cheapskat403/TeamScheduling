-- 1 of 3: CHECK. Read only, changes nothing.
-- Run this first. It returns ONE row; read it before going any further.
--
--   location                 must say the office you expect (NULL = wrong project or wrong id)
--   desks / desks_by_floor   the desks that will be deleted
--   bookings                 desk bookings on those desks, which will be deleted with them
--   bookings_today_or_later  if this is not 0, make sure those bookings really are expendable
--   rooms_walls_labels       old floor plan shapes that will be deleted (see the note in 3-apply.sql)
--   floor_plan_settings      existing background drawings

select
  (select name from locations where id = 'jhb')                                          as location,
  (select count(*) from desks where location_id = 'jhb')                                 as desks,
  (select string_agg(floor || ': ' || n, ', ' order by floor)
     from (select floor, count(*) as n from desks where location_id = 'jhb' group by floor) f) as desks_by_floor,
  (select count(*) from desk_bookings where desk_id in (select id from desks where location_id = 'jhb'))                   as bookings,
  (select count(*) from desk_bookings where desk_id in (select id from desks where location_id = 'jhb')
     and date >= (now() at time zone 'Africa/Johannesburg')::date)                               as bookings_today_or_later,
  (select count(*) from floor_elements where location_id = 'jhb')                        as rooms_walls_labels,
  (select string_agg(key, ', ') from settings where key like 'floorplan_bg_%')                   as floor_plan_settings;
