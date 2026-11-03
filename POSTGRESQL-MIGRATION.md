# Moving from Supabase to PostgreSQL

The app can talk to a PostgreSQL server directly (for example Azure Database for PostgreSQL) instead of Supabase.
Routes are unchanged: `config/supabase.js` hands them either the Supabase client or a PostgreSQL client with the same
calls (`utils/pgQueryBuilder.js`). `DB_PROVIDER` chooses which.

## Settings

| Variable | Meaning |
| --- | --- |
| `DB_PROVIDER` | `supabase` (default) or `postgres` |
| `DATABASE_URL` | Full connection string. Use this **or** the four variables below |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Connection details; `DB_PORT` defaults to 5432 |
| `DB_SSL` | `require` (default, verifies the certificate), `no-verify`, or `disable` (local only) |
| `DB_POOL_MAX` | Connection pool size, default 10 |

Azure Database for PostgreSQL only accepts connections from IP addresses allowed in its firewall rules, and requires SSL.
Add the address of whatever runs the app (and of your own machine, for the migration) to that firewall first.

## Moving the data

The data stays in Supabase until you run the copy. The script only reads from Supabase and writes to the target in a
single transaction, then compares every table's keys with the source; a mismatch rolls everything back.

1. Put the target's `DB_*` settings and the source's `SUPABASE_URL` / `SUPABASE_SECRET_KEY` in your environment.
2. `node scripts/migrate-supabase-to-postgres.js --dry-run` reads the source, checks the target and writes nothing.
3. `node scripts/migrate-supabase-to-postgres.js` creates the tables from `scripts/postgres/1-create-schema.sql` and copies the data.
   It refuses to run if the target already has rows; add `--replace` to empty the target's tables first.
4. Set `DB_PROVIDER=postgres` where the app runs, restart, and check the app.

To go back, set `DB_PROVIDER=supabase`. Anything written to the new database after the copy is not copied back.

`node scripts/migrate-supabase-to-postgres.js --schema-only` just creates the empty tables.

## Doing it by hand: the SQL scripts in scripts/postgres/

Three plain SQL files. Run them in order in any PostgreSQL query tool that can reach the target (pgAdmin, Azure Data Studio,
DBeaver, psql, the Azure portal's query editor).

| Script | What it does |
| --- | --- |
| `1-create-schema.sql` | Creates the tables on the target. Safe to run twice. |
| `2-load-data.sql` | Loads all the data in one transaction (a failure changes nothing). Run it on an **empty** database. It ends with a table of row counts. |
| `3-verify.sql` | Read only. Run on the source and the target: counts and key fingerprints must match. |
| `4-add-audit-log.sql` | Adds the audit log table to a database created before it existed. New databases already have it. |
| `5-prevent-double-booking.sql` | Adds the two unique indexes that stop two people booking the same desk, or one person booking two desks, at the same moment. New databases already have them. **Run this on any database created before the indexes existed, or double bookings are possible.** It refuses, changing nothing, if double bookings already exist. |

`2-load-data.sql` is generated from Supabase, so it holds a snapshot of the data at that moment and real data (names, emails,
photos, about 800 KB for the test project). It is ignored by git: keep it private and delete it when you are done. To make a fresh
one (this only reads from Supabase and needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment):

```
node scripts/migrate-supabase-to-postgres.js --export-sql=scripts/postgres/2-load-data.sql
```

Bookings made in the app after the snapshot are not in it, so make the snapshot just before switching, then switch the app over.

## Not covered by the switch

`scripts/setup-floor-plan.js` and `migrate-to-supabase.js` still talk to Supabase directly.
