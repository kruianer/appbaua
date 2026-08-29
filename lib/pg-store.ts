import { promises as fs } from "node:fs";
import path from "node:path";
import { type PoolConfig, Pool } from "pg";
import { type Repo, DEFAULT_REPO_MODEL } from "./repos";
import type { RepoStore } from "./store";
import { type TaskType, defaultTaskTypes } from "./task-types";
import type { TaskTypeStore } from "./task-store";
import type { WorkerState, WorkerStateStore } from "./worker-state";
import {
  type NewRunLogEntry,
  type RunLogEntry,
  type RunStatus,
  LOG_MAX_AGE_DAYS,
  LOG_MAX_ROWS,
} from "./run-log";
import { type RunLogStore, isIdleSummary } from "./run-log-store";
import {
  type WorkerStatus,
  type WorkerStatusStore,
  EMPTY_STATUS,
} from "./worker-status";
import type { PreviewStore } from "./preview-store";
import type { PreviewRow } from "./preview";
import type { AppHealth } from "./health";
import type { HealthStore } from "./health-store";
import {
  type HeartbeatStatus,
  EMPTY_HEARTBEAT_STATUS,
  normalizeHeartbeatStatus,
} from "./heartbeat";
import {
  type HealthSettings,
  DEFAULT_HEALTH_SETTINGS,
  normalizeSettings,
} from "./health-settings";
import { type AlertState, normalizeAlertState } from "./telegram-alerts";
import type { AuthStore } from "./auth-store";
import type {
  AuthUser,
  AuthCredential,
  AuthSession,
  AuthChallenge,
  AuthInvitation,
  AuthBackupCode,
} from "./auth-types";

// PostgreSQL-backed store. Selected automatically when DATABASE_URL or PGHOST
// is set (see store.ts). "position" holds the priority order (0 = highest);
// list() returns rows sorted by it, replace() rewrites the whole ordered set
// in a transaction so the array index becomes the new position.

let pool: Pool | null = null;

/**
 * Build the pg pool config from env. Prefers discrete PG* fields over a
 * connection string: a password with URL-unsafe chars (+ / =) breaks
 * connectionString parsing ("Invalid URL"), but is fine as a plain field.
 * Exported for testing.
 */
export function poolConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  if (env.PGHOST || env.PGUSER) {
    return {
      host: env.PGHOST,
      port: env.PGPORT ? Number(env.PGPORT) : undefined,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: env.PGDATABASE,
    };
  }
  return { connectionString: env.DATABASE_URL };
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(poolConfigFromEnv());
  }
  return pool;
}

/**
 * Wraps a one-shot setup so it runs at most once — but is retried after a
 * failure. Caching the REJECTED promise would be fatal: the first attempt can
 * fail just because the DB was not accepting connections yet (or schema.sql was
 * briefly unreadable), and every later query would then keep failing until the
 * container restarts (bug-005). Exported for testing.
 */
export function retryingOnce(run: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending) {
      pending = run().catch((err) => {
        pending = null; // der nächste Aufruf versucht es erneut
        throw err;
      });
    }
    return pending;
  };
}

const ensureSchema = retryingOnce(async () => {
  const sql = await fs.readFile(
    path.join(process.cwd(), "lib", "schema.sql"),
    "utf8",
  );
  await getPool().query(sql);
});

export function createPgStore(): RepoStore {
  return {
    async list(): Promise<Repo[]> {
      await ensureSchema();
      const res = await getPool().query<{
        id: string;
        name: string;
        url: string;
        active: boolean;
        model: string | null;
        monitored: boolean | null;
      }>(
        "SELECT id, name, url, active, model, monitored FROM repos ORDER BY position ASC",
      );
      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        active: r.active,
        // Backfill for a row written before req-028 (no model column value yet).
        model: (r.model as Repo["model"]) || DEFAULT_REPO_MODEL,
        // Same for req-032's switch: a row from before it is not watched.
        monitored: r.monitored ?? false,
      }));
    },

    async replace(repos: Repo[]): Promise<Repo[]> {
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM repos");
        for (let i = 0; i < repos.length; i++) {
          const r = repos[i];
          await client.query(
            "INSERT INTO repos (id, name, url, active, position, model, monitored) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [r.id, r.name, r.url, r.active, i, r.model, r.monitored],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return repos;
    },
  };
}

export function createPgTaskStore(): TaskTypeStore {
  return {
    async list(): Promise<TaskType[]> {
      await ensureSchema();
      const res = await getPool().query<{
        id: string;
        label: string;
        active: boolean;
        always: boolean;
        schedule: TaskType["schedule"];
      }>(
        "SELECT id, label, active, always, schedule FROM task_types ORDER BY position ASC",
      );
      if (res.rows.length === 0) {
        const seeded = defaultTaskTypes();
        await this.replace(seeded);
        return seeded;
      }
      return res.rows.map((r) => ({
        id: r.id,
        label: r.label,
        active: r.active,
        always: r.always,
        schedule: r.schedule,
      }));
    },

    async replace(types: TaskType[]): Promise<TaskType[]> {
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM task_types");
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          await client.query(
            "INSERT INTO task_types (id, label, active, always, schedule, position) VALUES ($1, $2, $3, $4, $5, $6)",
            [t.id, t.label, t.active, t.always, JSON.stringify(t.schedule), i],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return types;
    },
  };
}

export function createPgWorkerStore(): WorkerStateStore {
  return {
    async get(): Promise<WorkerState> {
      await ensureSchema();
      const res = await getPool().query<{ enabled: boolean }>(
        "SELECT enabled FROM worker_state WHERE id = 'worker'",
      );
      if (res.rows.length === 0) return { enabled: true }; // default on
      return { enabled: res.rows[0].enabled };
    },
    async set(state: WorkerState): Promise<WorkerState> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO worker_state (id, enabled) VALUES ('worker', $1)
         ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [state.enabled],
      );
      return state;
    },
  };
}

export function createPgRunLogStore(): RunLogStore {
  type Row = {
    id: string;
    started_at: Date;
    ended_at: Date;
    repo: string | null;
    task_type: string | null;
    status: string;
    message: string;
    md: string | null;
  };
  const toEntry = (r: Row): RunLogEntry => ({
    id: Number(r.id),
    startedAt: new Date(r.started_at).toISOString(),
    endedAt: new Date(r.ended_at).toISOString(),
    repo: r.repo,
    taskType: r.task_type,
    status: r.status as RunStatus,
    message: r.message,
    // NULL on rows written before req-015 — those show no second line.
    md: r.md,
  });
  const COLUMNS = "id, started_at, ended_at, repo, task_type, status, message, md";

  return {
    async append(entry: NewRunLogEntry): Promise<RunLogEntry> {
      await ensureSchema();
      const res = await getPool().query<Row>(
        `INSERT INTO run_log (started_at, ended_at, repo, task_type, status, message, md)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${COLUMNS}`,
        [
          entry.startedAt,
          entry.endedAt,
          entry.repo,
          entry.taskType,
          entry.status,
          entry.message,
          entry.md ?? null,
        ],
      );
      // Retention: drop rows older than the age cutoff, then any beyond max rows.
      await getPool().query(
        `DELETE FROM run_log WHERE started_at < now() - ($1 || ' days')::interval`,
        [LOG_MAX_AGE_DAYS],
      );
      await getPool().query(
        `DELETE FROM run_log WHERE id IN (
           SELECT id FROM run_log ORDER BY id DESC OFFSET $1
         )`,
        [LOG_MAX_ROWS],
      );
      return toEntry(res.rows[0]);
    },
    async upsertIdle(entry: NewRunLogEntry): Promise<RunLogEntry> {
      await ensureSchema();
      // Is the newest row already an idle-summary? Then only move its end
      // ("last checked") and message forward (req-021), keeping its start.
      const newest = await getPool().query<Row>(
        `SELECT ${COLUMNS} FROM run_log ORDER BY id DESC LIMIT 1`,
      );
      const last = newest.rows[0] ? toEntry(newest.rows[0]) : null;
      if (last && isIdleSummary(last)) {
        const upd = await getPool().query<Row>(
          `UPDATE run_log SET ended_at = $1, message = $2 WHERE id = $3
           RETURNING ${COLUMNS}`,
          [entry.endedAt, entry.message, last.id],
        );
        return toEntry(upd.rows[0]);
      }
      return this.append(entry);
    },
    async list(offset: number, limit: number): Promise<RunLogEntry[]> {
      await ensureSchema();
      const res = await getPool().query<Row>(
        `SELECT ${COLUMNS}
         FROM run_log ORDER BY id DESC OFFSET $1 LIMIT $2`,
        [offset, limit],
      );
      return res.rows.map(toEntry);
    },
    async count(): Promise<number> {
      await ensureSchema();
      const res = await getPool().query<{ c: string }>(
        "SELECT COUNT(*)::text AS c FROM run_log",
      );
      return Number(res.rows[0].c);
    },
    async metricsSince(sinceIso: string) {
      await ensureSchema();
      const res = await getPool().query<{ done: string; errors: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('success','error'))::text AS done,
           COUNT(*) FILTER (WHERE status = 'error')::text AS errors
         FROM run_log WHERE started_at >= $1`,
        [sinceIso],
      );
      return {
        done: Number(res.rows[0].done),
        errors: Number(res.rows[0].errors),
      };
    },
    async lastError(): Promise<RunLogEntry | null> {
      await ensureSchema();
      const res = await getPool().query<Row>(
        `SELECT ${COLUMNS}
         FROM run_log WHERE status = 'error' ORDER BY id DESC LIMIT 1`,
      );
      return res.rows.length ? toEntry(res.rows[0]) : null;
    },
    async clear(): Promise<void> {
      await ensureSchema();
      // Only run_log — repos, task_types, worker_state and worker_status stay.
      await getPool().query("DELETE FROM run_log");
    },
  };
}

export function createPgWorkerStatusStore(): WorkerStatusStore {
  const iso = (d: Date | null): string | null =>
    d ? new Date(d).toISOString() : null;
  return {
    async get(): Promise<WorkerStatus> {
      await ensureSchema();
      const res = await getPool().query<{
        current_repo: string | null;
        current_type: string | null;
        step_started_at: Date | null;
        pause_until: Date | null;
        current_md: string | null;
        current_output: string | null;
        pause_reason: string | null;
        current_model: string | null;
      }>(
        `SELECT current_repo, current_type, step_started_at, pause_until,
                current_md, current_output, pause_reason, current_model
         FROM worker_status WHERE id = 'worker'`,
      );
      if (res.rows.length === 0) return { ...EMPTY_STATUS };
      const r = res.rows[0];
      return {
        currentRepo: r.current_repo,
        currentType: r.current_type,
        currentMd: r.current_md,
        currentOutput: r.current_output,
        currentModel: r.current_model,
        stepStartedAt: iso(r.step_started_at),
        pauseUntil: iso(r.pause_until),
        pauseReason: r.pause_reason,
      };
    },
    async set(status: WorkerStatus): Promise<WorkerStatus> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO worker_status (id, current_repo, current_type, step_started_at, pause_until, current_md, current_output, pause_reason, current_model)
         VALUES ('worker', $1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           current_repo = EXCLUDED.current_repo,
           current_type = EXCLUDED.current_type,
           step_started_at = EXCLUDED.step_started_at,
           pause_until = EXCLUDED.pause_until,
           current_md = EXCLUDED.current_md,
           current_output = EXCLUDED.current_output,
           pause_reason = EXCLUDED.pause_reason,
           current_model = EXCLUDED.current_model`,
        [
          status.currentRepo,
          status.currentType,
          status.stepStartedAt,
          status.pauseUntil,
          status.currentMd,
          status.currentOutput,
          status.pauseReason,
          status.currentModel,
        ],
      );
      return status;
    },
  };
}

export function createPgPreviewStore(): PreviewStore {
  return {
    async get(): Promise<PreviewRow[]> {
      await ensureSchema();
      const res = await getPool().query<{ rows: PreviewRow[] }>(
        "SELECT rows FROM preview WHERE id = 'worker'",
      );
      return res.rows[0]?.rows ?? [];
    },
    async set(rows: PreviewRow[]): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO preview (id, rows) VALUES ('worker', $1)
         ON CONFLICT (id) DO UPDATE SET rows = EXCLUDED.rows`,
        [JSON.stringify(rows)],
      );
    },
  };
}

export function createPgHealthStore(): HealthStore {
  return {
    async getResults(): Promise<AppHealth[]> {
      await ensureSchema();
      const res = await getPool().query<{ data: { rows?: AppHealth[] } }>(
        "SELECT data FROM health WHERE id = 'results'",
      );
      return res.rows[0]?.data?.rows ?? [];
    },
    async setResults(rows: AppHealth[]): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO health (id, data) VALUES ('results', $1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [JSON.stringify({ rows })],
      );
    },
    async getSettings(): Promise<HealthSettings> {
      await ensureSchema();
      const res = await getPool().query<{ data: unknown }>(
        "SELECT data FROM health WHERE id = 'settings'",
      );
      return res.rows.length
        ? normalizeSettings(res.rows[0].data)
        : { ...DEFAULT_HEALTH_SETTINGS };
    },
    async setSettings(settings: HealthSettings): Promise<HealthSettings> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO health (id, data) VALUES ('settings', $1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [JSON.stringify(settings)],
      );
      return settings;
    },
    async getAlertState(): Promise<AlertState> {
      await ensureSchema();
      const res = await getPool().query<{ data: { entries?: unknown } }>(
        "SELECT data FROM health WHERE id = 'alerts'",
      );
      return normalizeAlertState(res.rows[0]?.data?.entries);
    },
    async setAlertState(state: AlertState): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO health (id, data) VALUES ('alerts', $1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        // In ein Objekt gewickelt, wie bei 'results': die Spalte ist jsonb und
        // ein leerer Zustand wäre sonst ein nacktes {} ohne Aussagekraft.
        [JSON.stringify({ entries: state })],
      );
    },
    async getHeartbeat(): Promise<HeartbeatStatus> {
      await ensureSchema();
      const res = await getPool().query<{ data: unknown }>(
        "SELECT data FROM health WHERE id = 'heartbeat'",
      );
      return res.rows.length
        ? normalizeHeartbeatStatus(res.rows[0].data)
        : { ...EMPTY_HEARTBEAT_STATUS };
    },
    async setHeartbeat(status: HeartbeatStatus): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO health (id, data) VALUES ('heartbeat', $1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [JSON.stringify(status)],
      );
    },
  };
}

export function createPgAuthStore(): AuthStore {
  const userRow = (r: {
    id: string;
    is_operator: boolean;
    created_at: Date;
  }): AuthUser => ({
    id: r.id,
    isOperator: r.is_operator,
    createdAt: new Date(r.created_at).toISOString(),
  });
  const credRow = (r: {
    id: string;
    user_id: string;
    public_key: string;
    counter: string;
    transports: string[];
    created_at: Date;
  }): AuthCredential => ({
    id: r.id,
    userId: r.user_id,
    publicKey: r.public_key,
    counter: Number(r.counter),
    transports: r.transports,
    createdAt: new Date(r.created_at).toISOString(),
  });
  const sessionRow = (r: {
    id: string;
    user_id: string;
    created_at: Date;
    expires_at: Date;
  }): AuthSession => ({
    id: r.id,
    userId: r.user_id,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  });
  const challengeRow = (r: {
    token: string;
    challenge: string;
    user_id: string | null;
    purpose: string;
    expires_at: Date;
  }): AuthChallenge => ({
    token: r.token,
    challenge: r.challenge,
    userId: r.user_id,
    purpose: r.purpose as AuthChallenge["purpose"],
    expiresAt: new Date(r.expires_at).toISOString(),
  });
  const invitationRow = (r: {
    token: string;
    created_by: string;
    created_at: Date;
    expires_at: Date;
    used_at: Date | null;
  }): AuthInvitation => ({
    token: r.token,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
  });
  const backupRow = (r: {
    id: string;
    user_id: string;
    code_hash: string | null;
    created_at: Date;
  }): AuthBackupCode => ({
    id: r.id,
    userId: r.user_id,
    codeHash: r.code_hash,
    createdAt: new Date(r.created_at).toISOString(),
  });

  return {
    async createUser(user) {
      await ensureSchema();
      await getPool().query(
        "INSERT INTO auth_users (id, is_operator, created_at) VALUES ($1, $2, $3)",
        [user.id, user.isOperator, user.createdAt],
      );
      return user;
    },
    async getUser(id) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, is_operator, created_at FROM auth_users WHERE id = $1",
        [id],
      );
      return res.rows[0] ? userRow(res.rows[0]) : null;
    },
    async countUsers() {
      await ensureSchema();
      const res = await getPool().query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM auth_users",
      );
      return Number(res.rows[0].count);
    },
    async getOperator() {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, is_operator, created_at FROM auth_users WHERE is_operator = TRUE LIMIT 1",
      );
      return res.rows[0] ? userRow(res.rows[0]) : null;
    },

    async addCredential(cred) {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO auth_credentials (id, user_id, public_key, counter, transports, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          cred.id,
          cred.userId,
          cred.publicKey,
          cred.counter,
          JSON.stringify(cred.transports),
          cred.createdAt,
        ],
      );
    },
    async getCredential(id) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, user_id, public_key, counter, transports, created_at FROM auth_credentials WHERE id = $1",
        [id],
      );
      return res.rows[0] ? credRow(res.rows[0]) : null;
    },
    async listCredentialsForUser(userId) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, user_id, public_key, counter, transports, created_at FROM auth_credentials WHERE user_id = $1",
        [userId],
      );
      return res.rows.map(credRow);
    },
    async updateCredentialCounter(id, counter) {
      await ensureSchema();
      await getPool().query(
        "UPDATE auth_credentials SET counter = $1 WHERE id = $2",
        [counter, id],
      );
    },

    async createSession(session) {
      await ensureSchema();
      await getPool().query(
        "INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
        [session.id, session.userId, session.createdAt, session.expiresAt],
      );
    },
    async getSession(id) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, user_id, created_at, expires_at FROM auth_sessions WHERE id = $1",
        [id],
      );
      return res.rows[0] ? sessionRow(res.rows[0]) : null;
    },
    async deleteSession(id) {
      await ensureSchema();
      await getPool().query("DELETE FROM auth_sessions WHERE id = $1", [id]);
    },

    async createChallenge(challenge) {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO auth_challenges (token, challenge, user_id, purpose, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          challenge.token,
          challenge.challenge,
          challenge.userId,
          challenge.purpose,
          challenge.expiresAt,
        ],
      );
    },
    async consumeChallenge(token) {
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          "SELECT token, challenge, user_id, purpose, expires_at FROM auth_challenges WHERE token = $1",
          [token],
        );
        await client.query("DELETE FROM auth_challenges WHERE token = $1", [
          token,
        ]);
        await client.query("COMMIT");
        return res.rows[0] ? challengeRow(res.rows[0]) : null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async createInvitation(invitation) {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO auth_invitations (token, created_by, created_at, expires_at, used_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invitation.token,
          invitation.createdBy,
          invitation.createdAt,
          invitation.expiresAt,
          invitation.usedAt,
        ],
      );
    },
    async getInvitation(token) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT token, created_by, created_at, expires_at, used_at FROM auth_invitations WHERE token = $1",
        [token],
      );
      return res.rows[0] ? invitationRow(res.rows[0]) : null;
    },
    async markInvitationUsed(token, usedAt) {
      await ensureSchema();
      await getPool().query(
        "UPDATE auth_invitations SET used_at = $1 WHERE token = $2",
        [usedAt, token],
      );
    },

    async addBackupCodes(codes) {
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        for (const c of codes) {
          await client.query(
            `INSERT INTO auth_backup_codes (id, user_id, code_hash, created_at)
             VALUES ($1, $2, $3, $4)`,
            [c.id, c.userId, c.codeHash, c.createdAt],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async listBackupCodesForUser(userId) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, user_id, code_hash, created_at FROM auth_backup_codes WHERE user_id = $1",
        [userId],
      );
      return res.rows.map(backupRow);
    },
    async findBackupCodeByHash(codeHash) {
      await ensureSchema();
      const res = await getPool().query(
        "SELECT id, user_id, code_hash, created_at FROM auth_backup_codes WHERE code_hash = $1 LIMIT 1",
        [codeHash],
      );
      return res.rows[0] ? backupRow(res.rows[0]) : null;
    },
    async consumeBackupCode(id) {
      await ensureSchema();
      await getPool().query(
        "UPDATE auth_backup_codes SET code_hash = NULL WHERE id = $1",
        [id],
      );
    },
    async clearBackupCodesForUser(userId) {
      await ensureSchema();
      await getPool().query("DELETE FROM auth_backup_codes WHERE user_id = $1", [
        userId,
      ]);
    },
  };
}
