import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { redact, REDACTED } from "./redact";

// bug-003: a GitHub token must never survive its way into the run log or the
// live output. These cover the filter itself; workspace.test.ts covers that the
// git helpers actually run their output through it.

const PAT = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FINE_GRAINED =
  "github_pat_11ABCDEFG0abcdefghijkl_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
const BASIC = Buffer.from(`x-access-token:${PAT}`, "utf8").toString("base64");

const savedToken = process.env.GITHUB_TOKEN;

// Start every case from a known environment — the filter reads GITHUB_TOKEN,
// and whatever the test host happens to have set must not decide the outcome.
beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

describe("redact (bug-003)", () => {
  it("AC: strips the credentials out of a URL git quotes back", () => {
    const stderr =
      `fatal: unable to access ` +
      `'https://x-access-token:${PAT}@github.com/kruianer/appbaua.git/': ` +
      `The requested URL returned error: 403`;
    const out = redact(stderr);
    expect(out).not.toContain(PAT);
    expect(out).toContain("https://***@github.com/kruianer/appbaua.git");
    // the useful half of the message survives
    expect(out).toContain("returned error: 403");
  });

  it("replaces a token the caller hands in, in whatever shape it appears", () => {
    const out = redact(`token=${PAT} header=${BASIC}`, [PAT]);
    expect(out).not.toContain(PAT);
    expect(out).not.toContain(BASIC);
    expect(out).toBe(`token=${REDACTED} header=${REDACTED}`);
  });

  it("replaces the token from the environment without being told", () => {
    // a token of no recognisable shape — only the environment gives it away
    const opaque = "s3cr3t-value-nobody-can-pattern-match";
    process.env.GITHUB_TOKEN = opaque;
    expect(redact(`push failed: bad credentials (${opaque})`)).toBe(
      `push failed: bad credentials (${REDACTED})`,
    );
  });

  it("recognises token shapes it was never given", () => {
    // e.g. a token echoed by some tool we called: neither the environment nor
    // the caller knows about it, only its shape gives it away
    expect(redact(`leaked: ${PAT}`)).toBe(`leaked: ${REDACTED}`);
    expect(redact(`leaked: ${FINE_GRAINED}`)).toBe(`leaked: ${REDACTED}`);
  });

  it("strips the value of an Authorization header", () => {
    const out = redact(`http.extraHeader=Authorization: Basic ${BASIC}`);
    expect(out).not.toContain(BASIC);
    expect(out).toBe(`http.extraHeader=Authorization: Basic ${REDACTED}`);
    expect(redact("authorization: Bearer abc.def.ghi")).toBe(
      `authorization: Bearer ${REDACTED}`,
    );
  });

  it("leaves a credential-free message exactly as it is", () => {
    const clean =
      "fatal: unable to access 'https://github.com/kruianer/appbaua.git/': " +
      "Could not resolve host: github.com — mail uwe@kremmel.org";
    expect(redact(clean)).toBe(clean);
    expect(redact("worker: bug-001.md abgearbeitet")).toBe(
      "worker: bug-001.md abgearbeitet",
    );
  });

  it("ignores an empty or absurdly short secret instead of blanking the text", () => {
    expect(redact("")).toBe("");
    // a 3-char "secret" would otherwise shred every message containing "abc"
    expect(redact("abc def abc", ["abc"])).toBe("abc def abc");
  });
});
