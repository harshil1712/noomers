CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  scope TEXT NOT NULL CHECK (scope IN ('stats', 'sites')),
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
