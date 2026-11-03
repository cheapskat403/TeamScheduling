-- 3 of 3: VERIFY. Read only. Run on the source AND the target and compare the two results.
--
--   psql "$DATABASE_URL" -f scripts/postgres/3-verify.sql
--
-- Result 1: rows per table. Result 2: a fingerprint per table (it changes if any key is missing or different).
-- The counts and fingerprints must be identical on both databases.

select 'locations' as table_name, count(*) as rows, md5(coalesce(string_agg(id::text, ',' order by id), '')) as key_fingerprint from locations
union all select 'teams', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from teams
union all select 'bookings', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from bookings
union all select 'public_holidays', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public_holidays
union all select 'desks', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from desks
union all select 'desk_bookings', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from desk_bookings
union all select 'floor_elements', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from floor_elements
union all select 'settings', count(*), md5(coalesce(string_agg(key::text, ',' order by key), '')) from settings
order by 1;

-- Next holiday id: must be higher than the largest existing id (a failed sequence reset would break adding holidays).
select max(id) as highest_holiday_id, last_value as sequence_position
from public_holidays, public_holidays_id_seq
group by last_value;
