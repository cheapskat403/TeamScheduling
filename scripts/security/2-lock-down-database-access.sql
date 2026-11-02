-- 2 of 3: LOCK DOWN direct database access.
--
-- Why: the old schema gave every table an "allow all" rule, so anyone holding the project's public
-- "anon" key could read, change or delete every row straight through Supabase's own API, skipping the
-- app's login and checks. The app itself uses the SECRET (service_role) key, which is not affected by
-- these rules, so removing them changes nothing for the app.
--
-- What it does (no data, tables or columns change):
--   1. turns row level security on for every table in the public schema
--   2. removes every policy on those tables (with no policy, anon/authenticated can do nothing)
--   3. also removes the anon / authenticated privileges on the tables, as a second lock
--
-- Before you run it: Render must use SUPABASE_SECRET_KEY (confirmed). Run on the TEST project first,
-- check the app still works locally, then run 1-check again. Undo with 3-rollback-...sql.

do $$
declare
  t record;
  p record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;

  for p in
    select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Expect: every table rls_on = true, policies = 0
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
