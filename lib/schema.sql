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

-- Task types (req-002). Predefined types, seeded on first use; the user only
-- edits priority (position), active and the per-weekday schedule (JSONB:
-- { mon: {enabled, start, end}, ... }). New types are added via code/seed.

CREATE TABLE IF NOT EXISTS task_types (
  id       TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  active   BOOLEAN NOT NULL DEFAULT TRUE,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS task_types_position_idx ON task_types (position);
