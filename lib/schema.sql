-- Schema for the repo list (req-001). Applied automatically on first use by
-- the Postgres store (ensureSchema). Order = priority is stored explicitly in
-- the "position" column (0 = highest priority).

CREATE TABLE IF NOT EXISTS repos (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  url      TEXT NOT NULL UNIQUE,
  active   BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS repos_position_idx ON repos (position);
