CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('event', 'pageview')),
    value TEXT NOT NULL,
    custom_props TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX goals_site_id_idx ON goals (site_id);

CREATE TABLE sites (
    domain TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'Etc/UTC',
    tracker_script_configuration TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    plausible_script_id TEXT
);

CREATE INDEX sites_created_at_idx ON sites (created_at, domain);
CREATE UNIQUE INDEX sites_plausible_script_id_idx ON sites (plausible_script_id);

CREATE TABLE site_tombstones (
    domain TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custom_properties (
    site_id TEXT NOT NULL,
    property TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (site_id, property),
    FOREIGN KEY (site_id) REFERENCES sites(domain) ON DELETE CASCADE
);

CREATE INDEX custom_properties_site_id_idx ON custom_properties (site_id);

CREATE TABLE site_deletion_jobs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    requested_at TEXT NOT NULL,
    iceberg_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (iceberg_status IN ('pending', 'completed', 'failed')),
    iceberg_updated_at TEXT,
    iceberg_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    completed_at TEXT,
    CHECK (completed_at IS NULL OR iceberg_status = 'completed')
);

CREATE INDEX site_deletion_jobs_pending_idx ON site_deletion_jobs (iceberg_status, requested_at);
