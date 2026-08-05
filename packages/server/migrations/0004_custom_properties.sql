CREATE TABLE custom_properties (
    site_id TEXT NOT NULL,
    property TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (site_id, property),
    FOREIGN KEY (site_id) REFERENCES sites(domain) ON DELETE CASCADE
);

CREATE INDEX custom_properties_site_id_idx ON custom_properties (site_id);
