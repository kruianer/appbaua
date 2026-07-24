import { promises as fs } from "node:fs";
import path from "node:path";
import { type PoolConfig, Pool } from "pg";
import type { Repo } from "./repos";
import type { RepoStore } from "./store";
import { type TaskType, defaultTaskTypes } from "./task-types";
import type { TaskTypeStore } from "./task-store";

// PostgreSQL-backed store. Selected automatically when DATABASE_URL or PGHOST
// is set (see store.ts). "position" holds the priority order (0 = highest);
// list() returns rows sorted by it, replace() rewrites the whole ordered set
// in a transaction so the array index becomes the new position.

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

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

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = await fs.readFile(
        path.join(process.cwd(), "lib", "schema.sql"),
        "utf8",
      );
      await getPool().query(sql);
    })();
  }
  return schemaReady;
}

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
        schedule: TaskType["schedule"];
      }>(
        "SELECT id, label, active, schedule FROM task_types ORDER BY position ASC",
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
            "INSERT INTO task_types (id, label, active, schedule, position) VALUES ($1, $2, $3, $4, $5)",
            [t.id, t.label, t.active, JSON.stringify(t.schedule), i],
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
