-- 4: ADD the audit log table to a database that was created before the audit log existed.
-- Safe to run more than once, changes no existing data. New databases get this table from
-- 1-create-schema.sql already, so they do not need this file.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres/4-add-audit-log.sql

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_email TEXT,                          -- who did it (NULL when logins are not enforced)
    actor_name TEXT,
    actor_id TEXT,
    action TEXT NOT NULL,                      -- create, update, delete, check-in
    entity TEXT,                               -- bookings, teams, desks, settings ...
    entity_id TEXT,
    outcome TEXT NOT NULL DEFAULT 'success',   -- success, denied (not allowed) or failed
    status INTEGER,                            -- HTTP status of the answer
    details JSONB                              -- the request, cut down (no photos or QR codes)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);

-- Expect one row: audit_log, 0 (or more once the app has been used)
SELECT 'audit_log' AS table_name, COUNT(*) AS rows FROM audit_log;
