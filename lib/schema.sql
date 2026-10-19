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

-- Added with req-028: the Claude model this repo's runs use. NULL on rows
-- written before req-028 — the store backfills those to the default (sonnet).
ALTER TABLE repos ADD COLUMN IF NOT EXISTS model TEXT;

-- Added with req-032: the "überwachen" switch of the Zustandsübersicht. Its own
-- column, independent of "active" — an app can be watched without the worker
-- working on it, and worked on without being watched. Existing rows default to
-- FALSE: watching reaches into a live system and is switched on deliberately.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS monitored BOOLEAN NOT NULL DEFAULT FALSE;

-- Added with req-044: how many Bugs+Requirements the worker may work off for
-- this repo per week. NULL means no limit — existing repos keep running
-- unbounded, as before.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS weekly_budget INTEGER;

-- Added with req-047: whether the Selbstauftrag task may write new
-- requirements into this repo. The switch belongs to the repo (like model
-- and weekly_budget above), not to task_types, which has no repo column and
-- would otherwise turn it on everywhere at once. Existing rows default to
-- FALSE: a repo never self-assigns until someone switches it on.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS self_assign BOOLEAN NOT NULL DEFAULT FALSE;

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

-- Added with req-037. error_kind: die Art eines Fehlers ('network',
-- 'rate-limit', 'auth', 'test-red', 'timeout', 'resources', 'other') als
-- eigenes Merkmal statt nur als Prosa in message — damit sich Haeufungen
-- filtern lassen, ohne im Text zu suchen. NULL bei erfolgreichen Laeufen und
-- bei Zeilen von vor req-037, deshalb kein DEFAULT.
ALTER TABLE run_log ADD COLUMN IF NOT EXISTS error_kind TEXT;

-- Was unmittelbar nach einem Netzwerkfehler gemessen wurde: war das Ziel
-- erreichbar, und wie lange dauerte der Verbindungsaufbau? Als JSON-Text, weil
-- der Inhalt je Fehlerart verschieden ist und sich weiterentwickeln darf, ohne
-- dass die Tabelle wandert.
ALTER TABLE run_log ADD COLUMN IF NOT EXISTS diagnostics TEXT;

CREATE INDEX IF NOT EXISTS run_log_error_kind_idx
  ON run_log (error_kind) WHERE error_kind IS NOT NULL;

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

-- The "Nächste Aktivitäten" preview (req-022). Single row keyed "worker",
-- holding the whole list as JSON — it is rebuilt wholesale after every pass,
-- never patched row by row, so one JSON blob is simpler than a table.
CREATE TABLE IF NOT EXISTS preview (
  id   TEXT PRIMARY KEY,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Zustandsübersicht der überwachten Apps (req-032). Four rows, all whole JSON
-- blobs: 'results' holds the last check results per app (rewritten wholesale
-- after every round), 'settings' the intervals and the per-Prüfart switches,
-- 'alerts' what Telegram has already reported (req-033) — so a restart of
-- the app does not re-announce an outage that was reported hours ago — and
-- 'heartbeat' when the watchdog at the webhoster last accepted a beat
-- (req-034), for the same reason: after a restart the Zustandsseite must show
-- the real last contact, not "noch nie".
CREATE TABLE IF NOT EXISTS health (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Consecutive network-abort counter per package (req-038). Single row keyed
-- "worker", one JSON blob mapping "<repo>::<md>" -> how many times in a row
-- that package just failed on a dropped connection. Must survive a worker
-- restart, unlike the rate-limit/auth-expired pause which only holds the loop
-- in memory for its own short wait.
CREATE TABLE IF NOT EXISTS network_abort_counts (
  id     TEXT PRIMARY KEY,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Passkey authentication (req-023). Person ≠ operator context: a user signs
-- in with a passkey; the app itself is worked in a single operator's context
-- (n:m-capable in shape, not built out — one operator, one-or-more users).

CREATE TABLE IF NOT EXISTS auth_users (
  id         TEXT PRIMARY KEY,
  is_operator BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per registered passkey (a user may have several, one per device).
-- counter guards against a cloned authenticator (WebAuthn replay defence).
CREATE TABLE IF NOT EXISTS auth_credentials (
  id                TEXT PRIMARY KEY, -- base64url credential ID
  user_id           TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  public_key        TEXT NOT NULL,    -- base64url COSE public key
  counter           BIGINT NOT NULL DEFAULT 0,
  transports        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_credentials_user_idx ON auth_credentials (user_id);

-- Sessions (opaque token, the cookie carries only its id). expires_at makes a
-- stale row inert without a background sweep having to run first.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);

-- A pending WebAuthn ceremony's server-generated challenge, so the same
-- server process is not required to finish what it started (Next.js runs
-- handlers statelessly). One outstanding challenge per token; short-lived.
CREATE TABLE IF NOT EXISTS auth_challenges (
  token      TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  user_id    TEXT,             -- set for a login/registration-add ceremony
  purpose    TEXT NOT NULL,    -- 'register' | 'login'
  expires_at TIMESTAMPTZ NOT NULL
);

-- Invitations (req-023: no open self-registration). A single-use token the
-- operator hands out; consuming it creates the invited user.
CREATE TABLE IF NOT EXISTS auth_invitations (
  token      TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

-- Recovery backup codes (req-023). Hashed, single-use: consuming one clears
-- its hash to NULL rather than deleting the row, so "10 issued, 3 left" stays
-- answerable without a separate counter.
CREATE TABLE IF NOT EXISTS auth_backup_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  code_hash  TEXT,             -- NULL once consumed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_backup_codes_user_idx ON auth_backup_codes (user_id);

-- Chat-UI-Zustand (req-040): welches Repo zuletzt offen war, damit der
-- Chat-Tab es beim nächsten Öffnen vorauswählt statt immer auf das erste
-- Repo der Liste zurückzufallen. Einzelne Zeile, Muster wie worker_state.
CREATE TABLE IF NOT EXISTS chat_ui_state (
  id             TEXT PRIMARY KEY,
  active_repo_id TEXT
);

-- Chat-Gespräche (req-040). Ein Verlauf-Eintrag je Nachricht, zeitlich
-- sortiert über die id. role: 'user' | 'assistant' | 'system' (Systemtexte
-- wie eine Rate-Limit-Meldung).
CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  repo_id    TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_repo_idx ON chat_messages (repo_id, id);

-- Eine Zeile je Repo mit laufendem/gewesenem Gespräch: die Claude-eigene
-- Sitzungskennung (für --resume, damit der nächste Turn denselben Kontext
-- fortsetzt) und wann zuletzt geschrieben wurde — das steuert sowohl die
-- Fünf-Sitzungen-Grenze (AC10) als auch das Acht-Stunden-Leerlaufende (AC12).
CREATE TABLE IF NOT EXISTS chat_sessions (
  repo_id           TEXT PRIMARY KEY,
  claude_session_id TEXT NOT NULL,
  last_active_at    TIMESTAMPTZ NOT NULL
);

-- Hinweispunkt auf dem Chat-Knopf (AC8/AC9): wahr, sobald ein Turn fertig
-- wurde, während sein Repo nicht das offene war; verschwindet, wenn es
-- geöffnet wird.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS unread BOOLEAN NOT NULL DEFAULT FALSE;

-- req-049: die Schritte des Zugs, der zu dieser Nachricht geführt hat (NULL
-- bei einer Nutzer-Nachricht und bei jeder Zeile von vor diesem Requirement).
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS steps TEXT;
