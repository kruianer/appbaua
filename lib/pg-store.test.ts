import { describe, it, expect, vi } from "vitest";
import { createPgStore, poolConfigFromEnv, retryingOnce } from "./pg-store";

// Reproduce-first: a DB password with URL-unsafe characters (+ / =), as
// produced by `openssl rand -base64`, must NOT be forced through URL parsing.
// The deployed app crashed with "TypeError: Invalid URL" because the compose
// file assembled postgres://user:pass@host/db and the password contained '/'.

// Fake pg pool. The first schema DDL fails — the container came up before the
// DB accepted connections, which is exactly the situation of bug-005.
const pg = vi.hoisted(() => ({
  queries: [] as string[],
  failSchemaOnce: true,
}));

vi.mock("pg", () => {
  class Pool {
    async query(sql: string) {
      pg.queries.push(sql);
      if (sql.includes("CREATE TABLE") && pg.failSchemaOnce) {
        pg.failSchemaOnce = false;
        throw new Error("the database system is starting up");
      }
      return { rows: [] };
    }
  }
  return { Pool };
});

describe("poolConfigFromEnv", () => {
  it("uses discrete fields when PG* vars are set (URL-unsafe password ok)", () => {
    const cfg = poolConfigFromEnv({
      PGHOST: "db",
      PGPORT: "5432",
      PGUSER: "appbaua",
      PGPASSWORD: "ab/cd+ef=gh", // the exact class of chars that broke the URL
      PGDATABASE: "appbaua_dev",
    });

    expect(cfg).toEqual({
      host: "db",
      port: 5432,
      user: "appbaua",
      password: "ab/cd+ef=gh",
      database: "appbaua_dev",
    });
    // Crucially, no connectionString is built from the password.
    expect("connectionString" in cfg).toBe(false);
  });

  it("falls back to DATABASE_URL when no PG* fields are present", () => {
    const cfg = poolConfigFromEnv({
      DATABASE_URL: "postgres://u:p@h:5432/d",
    });
    expect(cfg).toEqual({ connectionString: "postgres://u:p@h:5432/d" });
  });
});

// bug-005: das Schema-Setup-Promise wurde gecacht — auch im Fehlerfall. Ein
// einziger Fehlschlag (DB beim Start noch nicht bereit) legte damit jeden
// weiteren DB-Zugriff still, bis der Container neu startete.

describe("retryingOnce", () => {
  it("wiederholt nach einem Fehler, führt einen Erfolg aber nur einmal aus", async () => {
    let calls = 0;
    const setup = retryingOnce(async () => {
      calls += 1;
      if (calls === 1) throw new Error("db not ready");
    });

    await expect(setup()).rejects.toThrow("db not ready");
    await expect(setup()).resolves.toBeUndefined();
    await expect(setup()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("bündelt gleichzeitige Aufrufer auf einen laufenden Versuch", async () => {
    let calls = 0;
    const setup = retryingOnce(async () => {
      calls += 1;
      await Promise.resolve(); // das Setup braucht mindestens einen Tick
    });

    await Promise.all([setup(), setup(), setup()]);
    expect(calls).toBe(1);
  });
});

describe("Schema-Setup des Postgres-Stores", () => {
  it("AC: nach einem gescheiterten Setup gelingt der nächste Zugriff", async () => {
    const store = createPgStore();

    // Erster Zugriff: die DB ist noch nicht bereit, das Schema-Setup scheitert.
    await expect(store.list()).rejects.toThrow(
      "the database system is starting up",
    );

    // Kurz darauf erneut — das Setup wird neu versucht und der Zugriff gelingt.
    await expect(store.list()).resolves.toEqual([]);

    const schemaRuns = pg.queries.filter((q) => q.includes("CREATE TABLE"));
    expect(schemaRuns).toHaveLength(2);
  });
});
