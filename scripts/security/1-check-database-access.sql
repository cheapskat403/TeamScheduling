-- 1 of 3: CHECK who can reach the database directly. Read only, changes nothing.
-- Run this first in the Supabase SQL editor, on the TEST project before production.
--
-- Result 1: one row per table. Before the lock-down you expect rls_on = true and policies >= 1.
--           After the lock-down you expect rls_on = true and policies = 0.
-- Result 2: what the public "anon" and "authenticated" roles may do. After the lock-down it is empty.

select
  c.relname                                                   as table_name,
  c.relrowsecurity                                            as rls_on,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;
