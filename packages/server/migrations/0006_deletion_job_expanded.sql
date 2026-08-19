-- DEL-005: Expand site_deletion_jobs so daily rollup, Iceberg maintenance
-- (including an explicit 'blocked' state), and Analytics Engine expiry are
-- tracked independently, alongside attempt accounting, backoff scheduling,
-- lease ownership/expiry, and terminal completion.

-- The 0005 table cannot be widened in place because 'blocked' must be added to
-- the existing iceberg_status CHECK constraint. Rebuild the table in place so
-- the name and existing callers keep working.
ALTER TABLE site_deletion_jobs RENAME TO site_deletion_jobs_0005;

CREATE TABLE site_deletion_jobs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    requested_at TEXT NOT NULL,
    analytics_engine_status TEXT NOT NULL DEFAULT 'pending_expiry'
        CHECK (analytics_engine_status IN ('pending_expiry', 'expired')),
    analytics_engine_expires_at TEXT NOT NULL,
    iceberg_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (iceberg_status IN ('pending', 'blocked', 'completed', 'failed')),
    iceberg_updated_at TEXT,
    iceberg_error TEXT,
    daily_rollup_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (daily_rollup_status IN ('pending', 'completed', 'failed')),
    daily_rollup_updated_at TEXT,
    daily_rollup_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    lease_token TEXT UNIQUE,
    lease_owner TEXT,
    lease_expires_at TEXT,
    lease_acquired_at TEXT,
    completed_at TEXT,
    CHECK (
        completed_at IS NULL
        OR (
            daily_rollup_status = 'completed'
            AND iceberg_status = 'completed'
            AND analytics_engine_status = 'expired'
        )
    )
);

-- Backfill existing jobs: fresh attempt accounting, no lease, and due
-- immediately (next_attempt_at is set to the original request time, which is
-- always in the past for an existing job).
INSERT INTO site_deletion_jobs (
    id,
    site_id,
    requested_at,
    analytics_engine_status,
    analytics_engine_expires_at,
    iceberg_status,
    iceberg_updated_at,
    iceberg_error,
    daily_rollup_status,
    daily_rollup_updated_at,
    daily_rollup_error,
    attempt_count,
    next_attempt_at,
    last_error,
    lease_token,
    lease_owner,
    lease_expires_at,
    lease_acquired_at,
    completed_at
)
SELECT
    id,
    site_id,
    requested_at,
    analytics_engine_status,
    analytics_engine_expires_at,
    iceberg_status,
    iceberg_updated_at,
    iceberg_error,
    'pending',
    NULL,
    NULL,
    0,
    requested_at,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
FROM site_deletion_jobs_0005;

DROP TABLE site_deletion_jobs_0005;

CREATE INDEX site_deletion_jobs_iceberg_status_idx
    ON site_deletion_jobs (iceberg_status, requested_at);

CREATE INDEX site_deletion_jobs_due_idx
    ON site_deletion_jobs (next_attempt_at, lease_expires_at);