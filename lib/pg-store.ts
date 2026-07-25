import { promises as fs } from "node:fs";
import path from "node:path";
import { type PoolConfig, Pool } from "pg";
import type { Repo } from "./repos";
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
import type { RunLogStore } from "./run-log-store";
import {
  type WorkerStatus,
  type WorkerStatusStore,
  EMPTY_STATUS,
} from "./worker-status";

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
      }>("SELECT id, name, url, active FROM repos ORDER BY position ASC");
      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        active: r.active,
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
            "INSERT INTO repos (id, name, url, active, position) VALUES ($1, $2, $3, $4, $5)",
            [r.id, r.name, r.url, r.active, i],
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
  };
  const toEntry = (r: Row): RunLogEntry => ({
    id: Number(r.id),
    startedAt: new Date(r.started_at).toISOString(),
    endedAt: new Date(r.ended_at).toISOString(),
    repo: r.repo,
    taskType: r.task_type,
    status: r.status as RunStatus,
    message: r.message,
  });

  return {
    async append(entry: NewRunLogEntry): Promise<RunLogEntry> {
      await ensureSchema();
      const res = await getPool().query<Row>(
        `INSERT INTO run_log (started_at, ended_at, repo, task_type, status, message)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, started_at, ended_at, repo, task_type, status, message`,
        [
          entry.startedAt,
          entry.endedAt,
          entry.repo,
          entry.taskType,
          entry.status,
          entry.message,
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
    async list(offset: number, limit: number): Promise<RunLogEntry[]> {
      await ensureSchema();
      const res = await getPool().query<Row>(
        `SELECT id, started_at, ended_at, repo, task_type, status, message
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
        `SELECT id, started_at, ended_at, repo, task_type, status, message
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
      }>(
        `SELECT current_repo, current_type, step_started_at, pause_until,
                current_md, current_output
         FROM worker_status WHERE id = 'worker'`,
      );
      if (res.rows.length === 0) return { ...EMPTY_STATUS };
      const r = res.rows[0];
      return {
        currentRepo: r.current_repo,
        currentType: r.current_type,
        currentMd: r.current_md,
        currentOutput: r.current_output,
        stepStartedAt: iso(r.step_started_at),
        pauseUntil: iso(r.pause_until),
      };
    },
    async set(status: WorkerStatus): Promise<WorkerStatus> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO worker_status (id, current_repo, current_type, step_started_at, pause_until, current_md, current_output)
         VALUES ('worker', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           current_repo = EXCLUDED.current_repo,
           current_type = EXCLUDED.current_type,
           step_started_at = EXCLUDED.step_started_at,
           pause_until = EXCLUDED.pause_until,
           current_md = EXCLUDED.current_md,
           current_output = EXCLUDED.current_output`,
        [
          status.currentRepo,
          status.currentType,
          status.stepStartedAt,
          status.pauseUntil,
          status.currentMd,
          status.currentOutput,
        ],
      );
      return status;
    },
  };
}
