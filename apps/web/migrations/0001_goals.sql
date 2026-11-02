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
