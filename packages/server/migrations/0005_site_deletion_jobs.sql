CREATE TABLE site_deletion_jobs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    requested_at TEXT NOT NULL,
    analytics_engine_status TEXT NOT NULL DEFAULT 'pending_expiry'
        CHECK (analytics_engine_status IN ('pending_expiry', 'expired')),
    analytics_engine_expires_at TEXT NOT NULL,
    iceberg_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (iceberg_status IN ('pending', 'completed', 'failed')),
    iceberg_updated_at TEXT,
    iceberg_error TEXT
);

CREATE INDEX site_deletion_jobs_iceberg_status_idx
    ON site_deletion_jobs (iceberg_status, requested_at);
