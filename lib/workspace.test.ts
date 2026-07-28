import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  authEnv,
  basicAuthHeader,
  REBASED_DETAIL,
  commitAndPush,
  isStaleBranchPush,
  prepareRepo,
  prepareRepoOnConvention,
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

// A step runs for minutes to an hour after resetting hard onto the remote.
// Whatever gets pushed to that branch meanwhile — the operator working in the
// same repo, another run touching it — leaves the worker's commit on a stale
// base, and git refuses it. Throwing away finished work over that is waste.
describe("Push auf veraltetem Stand: einmal rebasen statt aufgeben (bug-017)", () => {
  /** git's rejection when the remote has commits the push does not build on. */
  const STALE = [
    " ! [rejected]        main -> main (fetch first)",
    "error: failed to push some refs",
    "hint: Updates were rejected because the remote contains work that you do",
    "hint: not have locally.",
  ].join("\n");

  /** Fails the first push with `stderr`, lets a later one through. */
  function pushFailsOnce(stderr: string) {
    let pushes = 0;
    return fakeGit((args) => {
      const dirty = dirtyStatus(args);
      if (dirty) return dirty;
      if (args[0] !== "push") return undefined;
      pushes += 1;
      return pushes === 1 ? { ok: false, code: 1, stderr } : undefined;
    });
  }

  it("recognises only a stale branch, not a real refusal", () => {
    expect(isStaleBranchPush(STALE)).toBe(true);
    expect(isStaleBranchPush("non-fast-forward")).toBe(true);
    // A missing scope or a protected branch must NOT be retried — rebasing
    // changes nothing about either, and the second push would fail identically.
    expect(
      isStaleBranchPush(
        "refusing to allow a Personal Access Token to create or update workflow",
      ),
    ).toBe(false);
    expect(isStaleBranchPush("protected branch hook declined")).toBe(false);
    expect(isStaleBranchPush("Permission to repo denied")).toBe(false);
  });

  it("AC: fetches, rebases onto the new tip and pushes again", async () => {
    const { runImpl, calls } = pushFailsOnce(STALE);
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, {
      runImpl,
      branch: "main",
    });

    expect(res.pushed).toBe(true);
    expect(res.detail).toContain(REBASED_DETAIL);
    expect(sub(calls, "fetch")?.args).toEqual(["fetch", "origin", "main"]);
    expect(sub(calls, "rebase")?.args).toEqual(["rebase", "origin/main"]);
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(2);
  });

  it("retries exactly once — a second rejection is reported, not retried again", async () => {
    // Guards against a loop: were the retry itself retried, a branch somebody
    // keeps pushing to would spin here instead of ending the step.
    const { runImpl, calls } = fakeGit(
      (args) =>
        dirtyStatus(args) ??
        (args[0] === "push" ? { ok: false, code: 1, stderr: STALE } : undefined),
    );
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });

    expect(res.pushed).toBe(false);
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(2);
  });

  it("a conflicting rebase is aborted, so no working copy is left mid-rebase", async () => {
    // Both sides changed the same lines; picking a winner is not the worker's
    // call. What matters is that the next step finds a usable checkout.
    const { runImpl, calls } = fakeGit(
      (args) =>
        dirtyStatus(args) ??
        (args[0] === "push"
          ? { ok: false, code: 1, stderr: STALE }
          : args[0] === "rebase"
            ? { ok: false, code: 1, stderr: "CONFLICT (content): delivery/x.md" }
            : undefined),
    );
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });

    expect(res.pushed).toBe(false);
    expect(res.detail).toContain("push failed");
    expect(calls.some((c) => c.args[0] === "rebase" && c.args[1] === "--abort")).toBe(
      true,
    );
    // Only the first push happened: after a failed rebase there is nothing new
    // to push, so trying again would just repeat the same rejection.
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(1);
  });

  it("a refusal that is not about staleness is NOT retried", async () => {
    const { runImpl, calls } = fakeGit(
      (args) =>
        dirtyStatus(args) ??
        (args[0] === "push"
          ? { ok: false, code: 1, stderr: "protected branch hook declined" }
          : undefined),
    );
    const res = await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });

    expect(res.pushed).toBe(false);
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(1);
    expect(calls.some((c) => c.args[0] === "rebase")).toBe(false);
  });

  it("the retry carries the credential too, and never in an argument", async () => {
    const { runImpl, calls } = pushFailsOnce(STALE);
    await commitAndPush(repoDir(FRESH), "worker: x", PAT, { runImpl });

    const pushes = calls.filter((c) => c.args[0] === "push");
    for (const p of pushes) expect(p.opts.env?.GIT_CONFIG_VALUE_0).toBeTruthy();
    for (const call of calls) {
      for (const arg of call.args) expect(arg).not.toContain(PAT);
    }
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

// req-020: der Worker legt nicht mehr fest auf `dev` ab. Welcher Branch es ist,
// steht in der devops.md des ZIELREPOS — ein Repo, das bewusst keinen
// dev-Branch führt, wird auf seinem eigenen Branch bearbeitet statt gar nicht.
describe("Branch-Konvention des Zielrepos (req-020)", () => {
  /** A devops.md whose dev environment names `branch`. */
  const namesBranch = (branch: string) =>
    [
      "## Environments",
      "",
      "| Environment | Branch | URL |",
      "|---|---|---|",
      `| dev | ${branch} | https://dev.example.com |`,
    ].join("\n");

  /** A devops.md that states a convention instead of a branch name. */
  const CONVENTION = [
    "## Environments",
    "",
    "| Environment | Branch | URL |",
    "|---|---|---|",
    "| dev | aktueller `feature/*`-Branch | https://dev.example.com |",
    "| prod | main | https://example.com |",
  ].join("\n");

  const reading = (devops: string | null) => async () => devops;

  /** ls-remote answers: which branches the remote has, and where its HEAD points. */
  function remote(opts: { branches: string[]; head: string }) {
    return (args: string[]) => {
      if (args[0] !== "ls-remote") return undefined;
      if (args.includes("--symref")) {
        return { stdout: `ref: refs/heads/${opts.head}\tHEAD\n1234abc\tHEAD\n` };
      }
      const wanted = args[args.length - 1].replace("refs/heads/", "");
      return opts.branches.includes(wanted) ? undefined : { ok: false, code: 2 };
    };
  }

  /** What `git rev-parse --abbrev-ref HEAD` says the working copy is on. */
  const headIs = (branch: string) => (args: string[]) =>
    args[0] === "rev-parse" && args.includes("--abbrev-ref")
      ? { stdout: `${branch}\n` }
      : undefined;

  /** Did any git call try to check out or push `dev`? */
  const touchesDev = (calls: GitCall[]) =>
    calls.some(
      (c) =>
        (c.args[0] === "checkout" || c.args[0] === "push") &&
        c.args.includes("dev"),
    );

  it("AC: nennt die devops.md 'dev', wird wie bisher auf dev gearbeitet", async () => {
    const { runImpl, calls } = fakeGit(remote({ branches: ["dev"], head: "main" }));

    const { dir, branch } = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(namesBranch("dev")),
    });

    expect(branch).toBe("dev");
    expect(dir).toBe(repoDir(FRESH));
    expect(sub(calls, "checkout")?.args).toEqual([
      "checkout",
      "-B",
      "dev",
      "origin/dev",
    ]);
    expect(sub(calls, "reset")?.args).toEqual(["reset", "--hard", "origin/dev"]);
  });

  it("die Konvention wird aus der devops.md des Zielrepos gelesen", async () => {
    const read = vi.fn(async () => namesBranch("dev"));
    const { runImpl } = fakeGit(remote({ branches: ["dev"], head: "main" }));

    await prepareRepoOnConvention(FRESH, PAT, { runImpl, readFileImpl: read });

    expect(read).toHaveBeenCalledWith(repoDir(FRESH), "delivery/devops.md");
  });

  it("AC: bei einer Konvention statt eines Namens bleibt er auf dem ausgecheckten Branch", async () => {
    const { runImpl, calls } = fakeGit(
      (args) =>
        headIs("feature/garten")(args) ??
        remote({ branches: ["feature/garten", "main"], head: "main" })(args),
    );

    const { branch } = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(CONVENTION),
    });

    expect(branch).toBe("feature/garten");
    expect(sub(calls, "checkout")?.args).toEqual([
      "checkout",
      "-B",
      "feature/garten",
      "origin/feature/garten",
    ]);
    expect(touchesDev(calls)).toBe(false); // AC: KEIN dev angelegt
  });

  it("AC: ein nur lokal übrig gebliebenes dev zählt nicht als der Branch des Repos", async () => {
    // Genau der Zustand, den der alte Worker hinterlassen hat: ein lokales dev,
    // das die Gegenseite nie gesehen hat. Dann gilt der Default-Branch.
    const { runImpl, calls } = fakeGit(
      (args) =>
        headIs("dev")(args) ?? remote({ branches: ["main"], head: "main" })(args),
    );

    const { branch } = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(CONVENTION),
    });

    expect(branch).toBe("main");
    expect(touchesDev(calls)).toBe(false);
  });

  it("nennt die devops.md einen Branch, den es noch nicht gibt, wird er angelegt", async () => {
    // Das Repo hat ihn selbst benannt — das ist seine Entscheidung, keine unsere.
    const { runImpl, calls } = fakeGit(remote({ branches: ["main"], head: "main" }));

    const { branch } = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(namesBranch("develop")),
    });

    expect(branch).toBe("develop");
    expect(sub(calls, "checkout")?.args).toEqual(["checkout", "-B", "develop"]);
    expect(calls.some((c) => c.args[0] === "reset")).toBe(false); // nichts zum Zurücksetzen
  });

  it("ohne devops.md bleibt es beim bisherigen Verhalten: dev, sonst Default (req-013)", async () => {
    const withDev = fakeGit(remote({ branches: ["dev", "main"], head: "main" }));
    const onDev = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl: withDev.runImpl,
      readFileImpl: reading(null),
    });
    expect(onDev.branch).toBe("dev");

    const noDev = fakeGit(remote({ branches: ["master"], head: "master" }));
    const onDefault = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl: noDev.runImpl,
      readFileImpl: reading(null),
    });
    expect(onDefault.branch).toBe("master");
    expect(touchesDev(noDev.calls)).toBe(false); // kein dev angelegt
  });

  it("eine devops.md ohne Environments-Angabe zählt wie keine", async () => {
    const { runImpl } = fakeGit(remote({ branches: ["dev", "main"], head: "main" }));

    const { branch } = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading("# DevOps\n\n## Deploy Trigger\n\n- Push auf dev\n"),
    });

    expect(branch).toBe("dev");
  });

  it("AC: ein fehlgeschlagener Checkout bricht sichtbar ab, statt woanders zu committen", async () => {
    const { runImpl } = fakeGit((args) =>
      args[0] === "checkout"
        ? { ok: false, code: 1, stderr: `pathspec 'origin/dev' did not match; token ${PAT}` }
        : remote({ branches: ["dev"], head: "main" })(args),
    );

    const err = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(namesBranch("dev")),
    }).catch((e) => e);

    expect(String(err)).toContain("checkout dev failed");
    expect(String(err)).not.toContain(PAT); // bug-003 gilt weiter
  });

  it("eine unlesbare devops.md ist keine Angabe, kein Abbruch", async () => {
    const { runImpl } = fakeGit(remote({ branches: ["dev", "main"], head: "main" }));

    const { branch } = await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: async () => {
        throw new Error("Platte weg");
      },
    });

    expect(branch).toBe("dev");
  });

  it("räumt die Arbeitskopie auf, wie jeder andere Checkout auch (bug-002)", async () => {
    const { runImpl, calls } = fakeGit(remote({ branches: ["dev"], head: "main" }));

    await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(namesBranch("dev")),
    });

    expect(sub(calls, "clean")?.args).toEqual(["clean", "-fd"]);
  });

  it("kein git-Argument trägt den Token (bug-003)", async () => {
    const { runImpl, calls } = fakeGit(
      (args) =>
        headIs("feature/garten")(args) ??
        remote({ branches: ["feature/garten"], head: "main" })(args),
    );

    await prepareRepoOnConvention(FRESH, PAT, {
      runImpl,
      readFileImpl: reading(CONVENTION),
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const arg of call.args) expect(arg).not.toContain(PAT);
    }
  });
});
