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
  message    TEXT NOT NULL DEFAULT '',
  md         TEXT
);

CREATE INDEX IF NOT EXISTS run_log_started_idx ON run_log (started_at DESC);

-- Added with req-015; keep existing deployments in step. md: the .md the run
-- worked off, '' for a recurring type that has none. NULL means the name was
-- never recorded (rows from before req-015) — the Verlauf then shows no second
-- line rather than a made-up placeholder, so this column has no DEFAULT.
ALTER TABLE run_log ADD COLUMN IF NOT EXISTS md TEXT;

-- Live worker status (req-005). Single row keyed "worker". Holds the currently
-- running step (repo/task_type/started_at) while it runs, and pause_until while
-- the worker is in its 5-minute empty pause. All null = idle.

CREATE TABLE IF NOT EXISTS worker_status (
  id              TEXT PRIMARY KEY,
  current_repo    TEXT,
  current_type    TEXT,
  step_started_at TIMESTAMPTZ,
  pause_until     TIMESTAMPTZ,
  current_md      TEXT,
  current_output  TEXT
);

-- Added with req-008 (worker observability); keep existing deployments in step.
-- current_md: filename of the .md the running step works on (null = recurring
-- task). current_output: live tail (~50 lines) of the Claude-Code output of the
-- running step, cleared when the step ends.
ALTER TABLE worker_status ADD COLUMN IF NOT EXISTS current_md TEXT;
ALTER TABLE worker_status ADD COLUMN IF NOT EXISTS current_output TEXT;

-- Added with req-029: why the worker is paused, when the reason is special
-- enough to show (a rate limit). Null for the ordinary empty pause.
ALTER TABLE worker_status ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Added with req-027: the model the running step's Claude call actually
-- reported using, read from the event stream's own "init" event.
ALTER TABLE worker_status ADD COLUMN IF NOT EXISTS current_model TEXT;
