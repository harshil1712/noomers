CREATE TABLE sites (
    domain TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'Etc/UTC',
    tracker_script_configuration TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX sites_created_at_idx ON sites (created_at, domain);
