import { describe, it, expect } from "vitest";
import { poolConfigFromEnv } from "./pg-store";

// Reproduce-first: a DB password with URL-unsafe characters (+ / =), as
// produced by `openssl rand -base64`, must NOT be forced through URL parsing.
// The deployed app crashed with "TypeError: Invalid URL" because the compose
// file assembled postgres://user:pass@host/db and the password contained '/'.

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
