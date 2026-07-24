import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import type { Repo } from "./repos";
import type { RepoStore } from "./store";

// PostgreSQL-backed store. Selected automatically when DATABASE_URL is set
// (see store.ts). "position" holds the priority order (0 = highest); list()
// returns rows sorted by it, replace() rewrites the whole ordered set in a
// transaction so the array index becomes the new position.

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
