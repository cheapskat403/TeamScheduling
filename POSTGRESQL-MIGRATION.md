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
3. `node scripts/migrate-supabase-to-postgres.js` creates the tables from `postgresql-schema.sql` and copies the data.
   It refuses to run if the target already has rows; add `--replace` to empty the target's tables first.
4. Set `DB_PROVIDER=postgres` where the app runs, restart, and check the app.

To go back, set `DB_PROVIDER=supabase`. Anything written to the new database after the copy is not copied back.

`node scripts/migrate-supabase-to-postgres.js --schema-only` just creates the empty tables.

## Not covered by the switch

`scripts/setup-floor-plan.js` and `migrate-to-supabase.js` still talk to Supabase directly.
