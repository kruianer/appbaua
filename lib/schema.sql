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
  always   BOOLEAN NOT NULL DEFAULT TRUE,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL
);

-- Added after initial release; keep existing deployments in step.
ALTER TABLE task_types ADD COLUMN IF NOT EXISTS always BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS task_types_position_idx ON task_types (position);

-- Global worker on/off switch (req-003). Single row keyed "worker". Stores only
-- the desired state + its display; the effect on a running worker is separate.

CREATE TABLE IF NOT EXISTS worker_state (
  id      TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- Worker run log (req-004). One row per executed step or "nichts zu tun".
-- status: 'success' | 'error' | 'idle'. repo/task_type null for idle rows.
-- Retention (>1 year OR >1M rows, oldest first) is enforced on write.

CREATE TABLE IF NOT EXISTS run_log (
  id         BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ NOT NULL,
  repo       TEXT,
  task_type  TEXT,
  status     TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS run_log_started_idx ON run_log (started_at DESC);
