import { describe, it, expect } from "vitest";
import {
  isNetworkAbort,
  isClaudeTimeout,
  networkAbortKey,
  withoutKey,
  NETWORK_ABORT_MAX_ATTEMPTS,
  NETWORK_ABORT_PAUSE_MS,
} from "./network-abort";

describe("isNetworkAbort (req-038)", () => {
  it("recognises the exact wording from bug-021 in Wegfara (07.09.)", () => {
    expect(
      isNetworkAbort("API Error: Connection closed mid-response"),
    ).toBe(true);
  });

  it("recognises other dropped/failed connections to the KI provider", () => {
    expect(isNetworkAbort("Error: socket hang up")).toBe(true);
    expect(isNetworkAbort("FetchError: request failed, reason: ECONNRESET")).toBe(
      true,
    );
    expect(isNetworkAbort("getaddrinfo ENOTFOUND api.anthropic.com")).toBe(true);
    expect(isNetworkAbort("TypeError: fetch failed")).toBe(true);
  });

  it("recognises the same GitHub network faults bug-020 already retries once", () => {
    expect(
      isNetworkAbort("Repo vorbereiten (appbaua): Could not resolve host: github.com"),
    ).toBe(true);
    expect(
      isNetworkAbort("Push fehlgeschlagen (appbaua): Failed to connect to github.com port 443"),
    ).toBe(true);
    expect(isNetworkAbort("fatal: [timeout]")).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    expect(isNetworkAbort("FAIL lib/foo.test.ts > kaputt")).toBe(false);
    expect(isNetworkAbort("rate limit exceeded")).toBe(false);
    expect(isNetworkAbort("Failed to authenticate: OAuth session expired")).toBe(
      false,
    );
    expect(isNetworkAbort("")).toBe(false);
    expect(isNetworkAbort(null)).toBe(false);
    expect(isNetworkAbort(undefined)).toBe(false);
  });

  it("must not be confused with a Claude-run TIMEOUT (constraint)", () => {
    expect(
      isNetworkAbort("Claude-Lauf: Timeout (60 min) — zuletzt: still working"),
    ).toBe(false);
    // Even when the last-activity tail happens to mention a network word.
    expect(
      isNetworkAbort(
        "Claude-Lauf: Timeout (60 min) — zuletzt: retrying after ECONNRESET",
      ),
    ).toBe(false);
  });
});

describe("isClaudeTimeout (req-038)", () => {
  it("recognises the exact timeout summary shape from claude-runner", () => {
    expect(isClaudeTimeout("Claude-Lauf: Timeout (60 min)")).toBe(true);
  });
  it("does not fire on other failures", () => {
    expect(isClaudeTimeout("Connection closed mid-response")).toBe(false);
    expect(isClaudeTimeout(null)).toBe(false);
  });
});

describe("networkAbortKey / withoutKey (req-038)", () => {
  it("scopes the key by repo, since .md names repeat across repos", () => {
    expect(networkAbortKey("appbaua", "req-038-x.md")).toBe(
      "appbaua::req-038-x.md",
    );
    expect(networkAbortKey("wegfara", "req-038-x.md")).not.toBe(
      networkAbortKey("appbaua", "req-038-x.md"),
    );
  });

  it("removes only the given key, leaving the rest untouched", () => {
    const counts = { "a::x.md": 2, "a::y.md": 1 };
    expect(withoutKey(counts, "a::x.md")).toEqual({ "a::y.md": 1 });
    // immutable: the input is not mutated
    expect(counts).toEqual({ "a::x.md": 2, "a::y.md": 1 });
  });

  it("is a no-op when the key is absent", () => {
    expect(withoutKey({ "a::y.md": 1 }, "a::x.md")).toEqual({ "a::y.md": 1 });
  });
});

describe("NETWORK_ABORT_PAUSE_MS / NETWORK_ABORT_MAX_ATTEMPTS (req-038)", () => {
  it("is a short pause — minutes, not hours, unlike rate-limit/auth-expired", () => {
    expect(NETWORK_ABORT_PAUSE_MS).toBeGreaterThan(0);
    expect(NETWORK_ABORT_PAUSE_MS).toBeLessThan(60 * 60_000);
  });

  it("tolerates exactly three consecutive aborts before giving up", () => {
    expect(NETWORK_ABORT_MAX_ATTEMPTS).toBe(3);
  });
});
