-- 3 of 3: APPLY. THIS DELETES DATA. Only run it after 1-check.sql looked right and you saved 2-backup.sql.
--
-- It runs as one transaction: if anything fails, or the final check below fails, nothing is changed.
-- Make sure the project name at the top of the Supabase dashboard is the one you mean.
--
-- What it does for location 'jhb':
--   1. deletes every desk booking on its desks, then every desk (whatever floor name it has)
--   2. deletes its old rooms/walls/labels   <-- delete that one line below if you want to KEEP them
--   3. creates the 32 desks on floor 1
--   4. saves the floor 1 background drawing (/floorplans/jhb-floor-plan.svg) and sets the location to one floor
-- Other locations are never touched.

begin;

do $$
begin
  if not exists (select 1 from locations where id = 'jhb') then
    raise exception 'Location jhb was not found. Wrong project? Nothing was changed.';
  end if;
end $$;

delete from desk_bookings where desk_id in (select id from desks where location_id = 'jhb');
delete from desks         where location_id = 'jhb';
delete from floor_elements where location_id = 'jhb';

insert into desks (id, name, location_id, floor, zone, x, y, width, height, desk_type, assigned_team_id, chair_positions, qr_code) values
  ('jhb-a21', 'A21', 'jhb', '1', 'Open Plan', 9, 247, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a21-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a22', 'A22', 'jhb', '1', 'Open Plan', 40, 247, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a22-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a23', 'A23', 'jhb', '1', 'Open Plan', 71, 247, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a23-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a24', 'A24', 'jhb', '1', 'Open Plan', 102, 247, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a24-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a17', 'A17', 'jhb', '1', 'Open Plan', 9, 260, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a17-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a18', 'A18', 'jhb', '1', 'Open Plan', 40, 260, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a18-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a19', 'A19', 'jhb', '1', 'Open Plan', 71, 260, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a19-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a20', 'A20', 'jhb', '1', 'Open Plan', 102, 260, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a20-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a13', 'A13', 'jhb', '1', 'Open Plan', 9, 334, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a13-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a14', 'A14', 'jhb', '1', 'Open Plan', 40, 334, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a14-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a15', 'A15', 'jhb', '1', 'Open Plan', 71, 334, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a15-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a16', 'A16', 'jhb', '1', 'Open Plan', 102, 334, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a16-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a09', 'A09', 'jhb', '1', 'Open Plan', 9, 347, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a09-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a10', 'A10', 'jhb', '1', 'Open Plan', 40, 347, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a10-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a11', 'A11', 'jhb', '1', 'Open Plan', 71, 347, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a11-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a12', 'A12', 'jhb', '1', 'Open Plan', 102, 347, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a12-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a05', 'A05', 'jhb', '1', 'Open Plan', 9, 480, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a05-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a06', 'A06', 'jhb', '1', 'Open Plan', 40, 480, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a06-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a07', 'A07', 'jhb', '1', 'Open Plan', 71, 480, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a07-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a08', 'A08', 'jhb', '1', 'Open Plan', 102, 480, 28, 12, 'hotseat', null, '["top"]'::jsonb, 'jhb-a08-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a01', 'A01', 'jhb', '1', 'Open Plan', 9, 493, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a01-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a02', 'A02', 'jhb', '1', 'Open Plan', 40, 493, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a02-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a03', 'A03', 'jhb', '1', 'Open Plan', 71, 493, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a03-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-a04', 'A04', 'jhb', '1', 'Open Plan', 102, 493, 28, 12, 'hotseat', null, '["bottom"]'::jsonb, 'jhb-a04-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-qz-03', 'QZ-03', 'jhb', '1', 'First Insurance', 470, 12, 14, 30, 'hotseat', null, '["left"]'::jsonb, 'jhb-qz-03-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-qz-04', 'QZ-04', 'jhb', '1', 'First Insurance', 470, 44, 14, 30, 'hotseat', null, '["left"]'::jsonb, 'jhb-qz-04-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-qz-05', 'QZ-05', 'jhb', '1', 'First Insurance', 415, 12, 14, 30, 'hotseat', null, '["right"]'::jsonb, 'jhb-qz-05-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-qz-06', 'QZ-06', 'jhb', '1', 'First Insurance', 415, 43, 14, 30, 'hotseat', null, '["right"]'::jsonb, 'jhb-qz-06-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-qz-07', 'QZ-07', 'jhb', '1', 'First Insurance', 399, 11, 14, 30, 'hotseat', null, '["left"]'::jsonb, 'jhb-qz-07-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-qz-08', 'QZ-08', 'jhb', '1', 'First Insurance', 399, 43, 14, 30, 'hotseat', null, '["left"]'::jsonb, 'jhb-qz-08-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-sm01', 'SM01', 'jhb', '1', 'SM Room', 177, 226, 14, 30, 'hotseat', null, '["right"]'::jsonb, 'jhb-sm01-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  ('jhb-sm02', 'SM02', 'jhb', '1', 'SM Room', 177, 278, 14, 30, 'hotseat', null, '["right"]'::jsonb, 'jhb-sm02-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8));

insert into settings (key, value)
values ('floorplan_bg_jhb_1', '{"url":"/floorplans/jhb-floor-plan.svg","x":0,"y":0,"width":570,"height":800}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

delete from settings where key like 'floorplan_bg_jhb_%' and key <> 'floorplan_bg_jhb_1';

update locations set floors = 1 where id = 'jhb';

-- Final check: if this fails, the whole transaction is rolled back
do $$
declare
  n_desks int;
  n_off_floor int;
  n_names int;
begin
  select count(*) into n_desks     from desks where location_id = 'jhb';
  select count(*) into n_off_floor from desks where location_id = 'jhb' and floor <> '1';
  select count(distinct name) into n_names from desks where location_id = 'jhb';
  if n_desks <> 32 or n_off_floor <> 0 or n_names <> 32 then
    raise exception 'Final check failed (% desks, % off floor 1, % distinct names). Nothing was changed.', n_desks, n_off_floor, n_names;
  end if;
end $$;

commit;

-- Afterwards, run 1-check.sql again: it should show 32 desks, "1: 32", 0 bookings, 0 rooms_walls_labels
-- and floor_plan_settings = floorplan_bg_jhb_1.
