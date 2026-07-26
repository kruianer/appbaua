import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  authEnv,
  basicAuthHeader,
  commitAndPush,
  prepareRepo,
  prepareRepoOnDevOrDefault,
  remoteUrl,
  repoDir,
  type RunOptions,
  type RunResult,
} from "./workspace";

// bug-003: the worker used to bake the PAT into the remote URL, which put it in
// clear text into `.git/config` and into every git error message that quotes
// the URL back — and from there into the run log and the UI. The git helpers
// now authenticate through a header and scrub what they report.

const PAT = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FRESH = "github.com/appbaua-test/frisch";
const EXISTING = "github.com/appbaua-test/vorhanden";

type GitCall = { args: string[]; opts: RunOptions };

/**
 * Stands in for `run`: records every git invocation and answers it. `answer`
 * may override the result for a given subcommand; everything else succeeds
 * silently with empty output.
 */
function fakeGit(
  answer: (args: string[]) => Partial<RunResult> | undefined = () => undefined,
) {
  const calls: GitCall[] = [];
  const runImpl = async (
    _cmd: string,
    args: string[],
    opts: RunOptions = {},
  ): Promise<RunResult> => {
    calls.push({ args, opts });
    return { ok: true, code: 0, stdout: "", stderr: "", ...(answer(args) ?? {}) };
  };
  return { runImpl, calls };
}

const sub = (calls: GitCall[], name: string) =>
  calls.find((c) => c.args[0] === name);

/** git stderr as it looks when the credential travelled in the URL. */
const stderrWithToken = (verb: string) =>
  `remote: Invalid username or password.\nfatal: ${verb} failed for ` +
  `'https://x-access-token:${PAT}@github.com/appbaua-test/frisch.git/'`;

/** Answers `git status` as a working copy with something to commit. */
const dirtyStatus = (args: string[]) =>
  args[0] === "status"
    ? { stdout: " M delivery/bugs/ready/bug-003.md\n" }
    : undefined;

beforeEach(async () => {
  // FRESH must not exist (clone path), EXISTING must (fetch path).
  await fs.rm(repoDir(FRESH), { recursive: true, force: true });
  await fs.mkdir(path.join(repoDir(EXISTING), ".git"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(repoDir(EXISTING), { recursive: true, force: true });
});

describe("git-Auth ohne Token in der URL (bug-003)", () => {
  it("AC: no git argument carries the token, so .git/config cannot pick it up", async () => {
    const { runImpl, calls } = fakeGit(dirtyStatus);
    await prepareRepo(FRESH, PAT, { runImpl });
    await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const arg of call.args) expect(arg).not.toContain(PAT);
    }
  });

  it("clones from the plain https URL", async () => {
    const { runImpl, calls } = fakeGit();
    await prepareRepo(FRESH, PAT, { runImpl });
    expect(sub(calls, "clone")?.args).toEqual([
      "clone",
      "https://github.com/appbaua-test/frisch.git",
      repoDir(FRESH),
    ]);
  });

  it("AC: an existing checkout gets its remote rewritten, healing an old one", async () => {
    // A working copy an earlier worker left behind still has the token in its
    // .git/config; set-url is what replaces that line.
    const { runImpl, calls } = fakeGit();
    await prepareRepo(EXISTING, PAT, { runImpl });
    expect(sub(calls, "remote")?.args).toEqual([
      "remote",
      "set-url",
      "origin",
      "https://github.com/appbaua-test/vorhanden.git",
    ]);
  });

  it("hands the credential to the remote calls as a header instead", async () => {
    const { runImpl, calls } = fakeGit();
    await prepareRepo(FRESH, PAT, { runImpl });
    for (const name of ["clone", "ls-remote"]) {
      const env = sub(calls, name)?.opts.env;
      expect(env?.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
      expect(env?.GIT_CONFIG_VALUE_0).toBe(basicAuthHeader(PAT));
    }
  });

  it("the push authenticates the same way", async () => {
    const { runImpl, calls } = fakeGit(dirtyStatus);
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });
    expect(res.pushed).toBe(true);
    expect(sub(calls, "push")?.opts.env?.GIT_CONFIG_VALUE_0).toBe(
      basicAuthHeader(PAT),
    );
  });

  it("purely local calls need no credential at all", async () => {
    const { runImpl, calls } = fakeGit(dirtyStatus);
    await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });
    expect(sub(calls, "commit")).toBeDefined();
    expect(sub(calls, "commit")?.opts.env).toBeUndefined();
    expect(sub(calls, "add")?.opts.env).toBeUndefined();
  });

  it("basicAuthHeader sends the PAT as HTTP Basic auth", () => {
    expect(basicAuthHeader(PAT)).toBe(
      `Authorization: Basic ${Buffer.from(`x-access-token:${PAT}`).toString("base64")}`,
    );
  });

  it("remoteUrl carries no credentials", () => {
    expect(remoteUrl(FRESH)).toBe("https://github.com/appbaua-test/frisch.git");
  });

  it("git never stops to ask for a password in a headless worker", () => {
    expect(authEnv(PAT).GIT_TERMINAL_PROMPT).toBe("0");
  });
});

describe("git-Fehlermeldungen ohne Token (bug-003)", () => {
  it("AC: a failing clone is reported without the credential", async () => {
    const { runImpl } = fakeGit((args) =>
      args[0] === "clone"
        ? { ok: false, code: 128, stderr: stderrWithToken("clone") }
        : undefined,
    );
    const err = await prepareRepo(FRESH, PAT, { runImpl }).catch((e) => e);
    expect(String(err)).toContain("clone failed");
    expect(String(err)).not.toContain(PAT);
    expect(String(err)).toContain("Invalid username or password"); // still useful
  });

  it("AC: a failing fetch is reported without the credential", async () => {
    const { runImpl } = fakeGit((args) =>
      args[0] === "fetch"
        ? { ok: false, code: 128, stderr: stderrWithToken("fetch") }
        : undefined,
    );
    const err = await prepareRepo(EXISTING, PAT, { runImpl }).catch((e) => e);
    expect(String(err)).toContain("fetch failed");
    expect(String(err)).not.toContain(PAT);
  });

  it("AC: a failing push is reported without the credential", async () => {
    const { runImpl } = fakeGit(
      (args) =>
        dirtyStatus(args) ??
        (args[0] === "push"
          ? { ok: false, code: 128, stderr: stderrWithToken("push") }
          : undefined),
    );
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });
    expect(res.pushed).toBe(false);
    expect(res.detail).toContain("push failed");
    expect(res.detail).not.toContain(PAT);
  });

  it("a failing commit is reported without the credential", async () => {
    const { runImpl } = fakeGit(
      (args) =>
        dirtyStatus(args) ??
        (args[0] === "commit"
          ? { ok: false, code: 1, stderr: `nope, token was ${PAT}` }
          : undefined),
    );
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });
    expect(res.pushed).toBe(false);
    expect(res.detail).toContain("commit failed");
    expect(res.detail).not.toContain(PAT);
  });
});

// The worker's own steps live on dev (delivery/devops.md): prepareRepo checks it
// out and creates it from the default branch when the repo has none yet. The
// appbaua rollout no longer uses this path — see req-013 below.
describe("dev-Branch für die Worker-Schritte (req-006)", () => {
  it("AC: fehlt dev, wird es vom aktuellen HEAD (Default-Branch) abgezweigt", async () => {
    const { runImpl, calls } = fakeGit((args) =>
      args[0] === "ls-remote" ? { ok: false, code: 2 } : undefined,
    );
    await prepareRepo(FRESH, PAT, { runImpl });

    expect(sub(calls, "checkout")?.args).toEqual(["checkout", "-B", "dev"]);
    // Nothing to reset to: the branch starts at the cloned default branch.
    expect(calls.some((c) => c.args[0] === "reset")).toBe(false);
  });

  it("ein vorhandenes dev wird getrackt statt neu erzeugt", async () => {
    const { runImpl, calls } = fakeGit();
    await prepareRepo(FRESH, PAT, { runImpl });

    expect(sub(calls, "checkout")?.args).toEqual([
      "checkout",
      "-B",
      "dev",
      "origin/dev",
    ]);
  });

  it("ohne genannten Branch geht der Push auf dev", async () => {
    const { runImpl, calls } = fakeGit(dirtyStatus);
    await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });

    expect(sub(calls, "push")?.args).toEqual(["push", "origin", "dev"]);
  });
});

// req-013: die Umstellung eines Repos auf den appbaua-Standard darf im Zielrepo
// keinen neuen dev-Branch anlegen. Sie nimmt dessen dev nur, wenn es ihn schon
// gibt — sonst den Default-Branch des Zielrepos, wie immer der heißt.
describe("Ziel-Branch der Umstellung (req-013)", () => {
  /** A remote that has no `dev` and whose HEAD points at `def`. */
  const noDevHeadAt = (def: string) => (args: string[]) => {
    if (args[0] !== "ls-remote") return undefined;
    return args.includes("--symref")
      ? { stdout: `ref: refs/heads/${def}\tHEAD\n1234abc\tHEAD\n` }
      : { ok: false, code: 2 };
  };

  /** Did any git call try to check out or push `dev`? */
  const touchesDev = (calls: GitCall[]) =>
    calls.some(
      (c) =>
        (c.args[0] === "checkout" || c.args[0] === "push") &&
        c.args.includes("dev"),
    );

  it("AC: hat das Zielrepo nur main, wird auf main gearbeitet — kein dev angelegt", async () => {
    const { runImpl, calls } = fakeGit(noDevHeadAt("main"));

    const { dir, branch } = await prepareRepoOnDevOrDefault(FRESH, PAT, {
      runImpl,
    });

    expect(branch).toBe("main");
    expect(dir).toBe(repoDir(FRESH));
    expect(sub(calls, "checkout")?.args).toEqual([
      "checkout",
      "-B",
      "main",
      "origin/main",
    ]);
    expect(touchesDev(calls)).toBe(false);
  });

  it("AC: der Push eines solchen Zielrepos geht auf main, nicht auf dev", async () => {
    const { runImpl, calls } = fakeGit(dirtyStatus);

    const res = await commitAndPush(repoDir(FRESH), "appbaua: Standard", PAT, {
      runImpl,
      branch: "main",
    });

    expect(res.pushed).toBe(true);
    expect(res.detail).toBe("auf main gepusht");
    expect(sub(calls, "push")?.args).toEqual(["push", "origin", "main"]);
    expect(touchesDev(calls)).toBe(false);
  });

  it("AC: hat das Zielrepo ein dev, wird wie bisher dorthin gearbeitet", async () => {
    const { runImpl, calls } = fakeGit();

    const { branch } = await prepareRepoOnDevOrDefault(FRESH, PAT, { runImpl });

    expect(branch).toBe("dev");
    expect(sub(calls, "checkout")?.args).toEqual([
      "checkout",
      "-B",
      "dev",
      "origin/dev",
    ]);
    // Der Default-Branch interessiert dann gar nicht mehr.
    expect(calls.some((c) => c.args.includes("--symref"))).toBe(false);
  });

  it("AC: heißt der Default-Branch master, wird master genommen — kein main, kein dev", async () => {
    const { runImpl, calls } = fakeGit(noDevHeadAt("master"));

    const { branch } = await prepareRepoOnDevOrDefault(FRESH, PAT, { runImpl });

    expect(branch).toBe("master");
    expect(sub(calls, "checkout")?.args).toEqual([
      "checkout",
      "-B",
      "master",
      "origin/master",
    ]);
    expect(touchesDev(calls)).toBe(false);
    expect(calls.some((c) => c.args.includes("main"))).toBe(false);
  });

  it("ein unlesbarer Default-Branch bricht ab, statt einen Namen zu raten", async () => {
    const { runImpl, calls } = fakeGit((args) =>
      args[0] === "ls-remote" ? { ok: false, code: 2 } : undefined,
    );

    const err = await prepareRepoOnDevOrDefault(FRESH, PAT, { runImpl }).catch(
      (e) => e,
    );

    expect(String(err)).toContain("default branch unknown");
    expect(calls.some((c) => c.args[0] === "checkout")).toBe(false);
  });

  it("der Default-Branch wird beglaubigt geholt und verrät den Token nicht", async () => {
    const { runImpl, calls } = fakeGit(noDevHeadAt("main"));

    await prepareRepoOnDevOrDefault(FRESH, PAT, { runImpl });

    const symref = calls.find((c) => c.args.includes("--symref"));
    expect(symref?.args).toEqual(["ls-remote", "--symref", "origin", "HEAD"]);
    expect(symref?.opts.env?.GIT_CONFIG_VALUE_0).toBe(basicAuthHeader(PAT));
    for (const call of calls) {
      for (const arg of call.args) expect(arg).not.toContain(PAT);
    }
  });
});
