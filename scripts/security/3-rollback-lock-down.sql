-- 3 of 3: ROLLBACK of 2-lock-down-database-access.sql.
-- Puts back the original behaviour: an "allow all" policy on each app table, and the default
-- anon / authenticated privileges. Only use this if the lock-down caused a problem.
-- Note: this REOPENS direct database access to anyone holding the anon key.

grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['locations', 'teams', 'bookings', 'public_holidays', 'desks', 'desk_bookings', 'floor_elements', 'settings']
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('drop policy if exists %I on public.%I', 'Allow all on ' || tbl, tbl);
      execute format('create policy %I on public.%I for all using (true) with check (true)', 'Allow all on ' || tbl, tbl);
    end if;
  end loop;
end $$;
