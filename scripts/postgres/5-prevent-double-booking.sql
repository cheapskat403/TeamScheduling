-- 5: PREVENT double bookings, even when two people click at the very same moment.
--
-- The app checks "is this desk free?" and then books it. Two requests arriving together can both pass the
-- check, so the database itself has to refuse the second one. This adds two rules:
--   1. a desk can only be booked once per day
--   2. a person (by email) can only have one desk per day
-- New databases get these from 1-create-schema.sql already. Run this file on a database created before that,
-- including the one you loaded your data into. It changes no rows and is safe to run more than once.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres/5-prevent-double-booking.sql
--
-- If the data already contains duplicates the rules cannot be added, and the script stops with a list of them
-- (nothing is changed). Cancel the extra bookings in the app, then run it again.

BEGIN;

DO $$
DECLARE
  desk_dupes integer;
  person_dupes integer;
BEGIN
  SELECT count(*) INTO desk_dupes FROM (
    SELECT 1 FROM desk_bookings GROUP BY desk_id, date HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO person_dupes FROM (
    SELECT 1 FROM desk_bookings WHERE coalesce(employee_email, '') <> ''
    GROUP BY date, lower(employee_email) HAVING count(*) > 1
  ) p;

  IF desk_dupes > 0 OR person_dupes > 0 THEN
    RAISE EXCEPTION E'Existing double bookings: % desk(s) booked twice on a day, % person(s) with two desks on a day.\nList them with the two queries at the bottom of this file, cancel the extras, then run this again.', desk_dupes, person_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_desk_bookings_desk_date
  ON desk_bookings (desk_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_desk_bookings_person_date
  ON desk_bookings (date, lower(employee_email))
  WHERE coalesce(employee_email, '') <> '';

COMMIT;

-- Expect two rows
SELECT indexname FROM pg_indexes
WHERE tablename = 'desk_bookings' AND indexname IN ('uq_desk_bookings_desk_date', 'uq_desk_bookings_person_date')
ORDER BY indexname;

-- ---------------------------------------------------------------------------------------------------------
-- If the script stopped because of duplicates, these list them (run them by hand):
--
--   SELECT desk_name, date, count(*), string_agg(employee_name, ', ') AS people
--   FROM desk_bookings GROUP BY desk_id, desk_name, date HAVING count(*) > 1 ORDER BY date;
--
--   SELECT lower(employee_email) AS email, date, count(*), string_agg(desk_name, ', ') AS desks
--   FROM desk_bookings WHERE coalesce(employee_email, '') <> ''
--   GROUP BY date, lower(employee_email) HAVING count(*) > 1 ORDER BY date;
