import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { redact } from "./redact";
import { DEVOPS_FILE, devBranchFrom } from "./dev-branch";

/** What commitAndPush reports when the working copy holds nothing to commit. */
export const NO_CHANGES_DETAIL = "keine Aenderungen";

// Git workspace helpers for req-006. Clones/updates a target repo into a work
// dir using the GitHub token for auth, and ensures the `dev` branch. All git
// runs shell out; process output is captured for logging.
//
// req-013 adds a second way to check a repo out: the appbaua rollout must not
// leave a `dev` branch behind in a repo that never had one, so it takes the
// repo's own default branch in that case (prepareRepoOnDevOrDefault).
//
// req-020 adds the third and makes it the one the worker's own steps use
// (prepareRepoOnConvention): the branch is no longer appbaua's decision at all,
// it is read from the TARGET repo's devops.md. prepareRepo — fixed on `dev`,
// creating it where there is none — is left for appbaua's OWN checkout, the
// source of the rollout, where `dev` is a fact and not an assumption.
//
// bug-003: the token is never part of the remote URL — it travels as an HTTP
// Authorization header supplied per call (see authEnv), so it lands neither in
// `.git/config` nor in the URL git quotes back in its error messages. What git
// does print goes through the redaction filter before anyone logs it.

const WORK_ROOT = process.env.WORKER_WORKDIR || "/tmp/appbaua-work";

export type RunResult = { ok: boolean; code: number; stdout: string; stderr: string };

export type RunOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /**
   * Called with every stdout/stderr chunk as it arrives (req-008), so a
   * caller can publish a live tail while the process is still running. The
   * full output is still returned at the end.
   */
  onData?: (chunk: string) => void;
  /**
   * How the child's stdin is wired. "ignore" closes it right away, which
   * keeps a CLI from waiting on (and warning about) piped input that never
   * comes (bug-001). Defaults to a pipe nobody writes to.
   */
  stdin?: "ignore" | "pipe";
};

/** Seam so the git calls below can be observed in tests without a real repo. */
export type WorkspaceDeps = { runImpl?: typeof run };

/** A working copy plus the branch it is sitting on (req-013, req-020). */
export type PreparedRepo = { dir: string; branch: string };

export type PrepareDeps = WorkspaceDeps & {
  /**
   * Reads the repo's devops.md out of the working copy (req-020). A seam of its
   * own, so the branch decision is testable without a filesystem.
   */
  readFileImpl?: (dir: string, rel: string) => Promise<string | null>;
};

export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdin ?? "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    const emit = (chunk: string) => {
      if (!opts.onData) return;
      // A broken listener must never take the process down.
      try {
        opts.onData(chunk);
      } catch {
        /* ignore */
      }
    };
    // Optional chaining because an explicit stdio array widens the spawn type:
    // both streams are pipes here, so they are always present.
    child.stdout?.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      emit(s);
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      emit(s);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? stderr + "\n[timeout]" : stderr,
      });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, code: 127, stdout, stderr: String(err) });
    });
  });
}

/**
 * The URL git talks to and stores in `.git/config`: plain https, no credentials
 * (bug-003).
 */
export function remoteUrl(normalizedUrl: string): string {
  // normalizedUrl is like github.com/owner/repo
  return `https://${normalizedUrl}.git`;
}

/**
 * The Authorization header value that authenticates the PAT against GitHub.
 * Same credential as before (`x-access-token:<PAT>`), only sent as HTTP Basic
 * auth instead of being baked into the URL.
 */
export function basicAuthHeader(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `Authorization: Basic ${basic}`;
}

/**
 * Environment for every git call that talks to the remote (bug-003). The header
 * is handed over as one-shot config via GIT_CONFIG_*, which is what
 * `git -c http.extraHeader=…` does — but it also keeps the token out of the
 * process command line, where any `ps` could read it. Command-level config is
 * never written to `.git/config`, so nothing of this survives the call.
 */
export function authEnv(token: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: basicAuthHeader(token),
    // Headless worker: a rejected header must fail the call, not park git on a
    // username prompt that nobody will ever answer.
    GIT_TERMINAL_PROMPT: "0",
  };
}

/** Local directory name for a repo (owner-repo). */
export function repoDir(normalizedUrl: string): string {
  const slug = normalizedUrl.replace(/[^a-z0-9]+/gi, "-");
  return path.join(WORK_ROOT, slug);
}

/** The branch the worker commits on (delivery/devops.md). */
export const DEV_BRANCH = "dev";

/**
 * Clone (or fetch+reset) the repo into its work dir and make it commit-ready.
 * Which branch is checked out afterwards is left to the caller — that is the
 * only thing prepareRepo and prepareRepoOnDevOrDefault disagree about.
 */
async function syncRepo(
  normalizedUrl: string,
  token: string,
  git: typeof run,
): Promise<{ dir: string; auth: Record<string, string> }> {
  const dir = repoDir(normalizedUrl);
  const url = remoteUrl(normalizedUrl);
  const auth = authEnv(token);
  await fs.mkdir(WORK_ROOT, { recursive: true });

  const exists = await fs
    .stat(path.join(dir, ".git"))
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    const clone = await git("git", ["clone", url, dir], { env: auth });
    if (!clone.ok) throw new Error(`clone failed: ${redact(clone.stderr, [token])}`);
  } else {
    // Rewriting the remote also heals a working copy an earlier worker left
    // behind with the token in its URL: set-url replaces that line in
    // .git/config with the credential-free one (bug-003).
    await git("git", ["remote", "set-url", "origin", url], { cwd: dir });
    const fetch = await git("git", ["fetch", "origin"], { cwd: dir, env: auth });
    if (!fetch.ok) throw new Error(`fetch failed: ${redact(fetch.stderr, [token])}`);
  }

  // Ensure identity so commits succeed in a fresh container.
  await git("git", ["config", "user.email", "worker@appbaua.local"], { cwd: dir });
  await git("git", ["config", "user.name", "appbaua-worker"], { cwd: dir });

  return { dir, auth };
}

/**
 * Does the remote have this BRANCH? Asked as `refs/heads/<name>`, so a tag of
 * the same name cannot pass for one — the answer decides whether the rollout
 * may check the branch out, and a wrong yes would end in creating it (req-013).
 */
async function remoteHasBranch(
  git: typeof run,
  dir: string,
  auth: Record<string, string>,
  branch: string,
): Promise<boolean> {
  const res = await git(
    "git",
    ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`],
    { cwd: dir, env: auth },
  );
  return res.ok;
}

/**
 * Track `branch` and reset the working copy to it. Only for a branch that
 * exists on the remote — that is what makes the reset meaningful. A checkout
 * that fails throws instead of leaving the caller on some other branch: work
 * committed on the wrong branch is worse than a step that says it could not
 * start (req-020).
 */
async function checkoutTracking(
  git: typeof run,
  dir: string,
  branch: string,
  token: string,
): Promise<void> {
  const co = await git("git", ["checkout", "-B", branch, `origin/${branch}`], {
    cwd: dir,
  });
  if (!co.ok) {
    throw new Error(`checkout ${branch} failed: ${redact(co.stderr, [token])}`);
  }
  await git("git", ["reset", "--hard", `origin/${branch}`], { cwd: dir });
}

/**
 * The branch the working copy currently has checked out, or null when git
 * cannot name one (a detached HEAD, a repo without a commit).
 */
async function currentBranch(
  git: typeof run,
  dir: string,
): Promise<string | null> {
  const res = await git("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: dir,
  });
  const name = res.stdout.trim();
  return res.ok && name && name !== "HEAD" ? name : null;
}

/**
 * Clone (or fetch+reset) the repo and check out the branch ITS OWN devops.md
 * says the dev environment lives on (req-020). Returns the local path and the
 * branch that was checked out, or throws — every failure on this path has to be
 * loud, because a repo the worker cannot prepare is a repo whose work never
 * happens.
 *
 * Three cases, in the order the requirement states them:
 *
 *  - the devops.md names a concrete branch: that one. It is created when the
 *    remote does not have it yet — the repo asked for it by name, so this is
 *    its own decision and not a surprise branch;
 *  - the devops.md states a convention instead of a name ("aktueller
 *    `feature/*`-Branch"): the branch the working copy is already on, i.e. the
 *    one the repo itself has checked out. NOTHING is created here — a repo that
 *    deliberately has no `dev` must not grow one;
 *  - the devops.md says nothing usable: the behaviour of req-013 — the repo's
 *    `dev` if it has one, otherwise its default branch.
 *
 * The convention is read out of the working copy right after the fetch, i.e.
 * off the branch the clone landed on. That is the repo's own instruction file
 * and it changes about never; reading it from a second checkout would cost a
 * fetch on every step to learn the same answer.
 *
 * In the convention case a current branch the REMOTE does not have does not
 * count as one: that is a leftover of an earlier run in this work directory —
 * exactly the `dev` this requirement does away with — and the repo's default
 * branch is taken instead.
 */
export async function prepareRepoOnConvention(
  normalizedUrl: string,
  token: string,
  deps: PrepareDeps = {},
): Promise<PreparedRepo> {
  const git = deps.runImpl ?? run;
  const read = deps.readFileImpl ?? readRepoFile;
  const { dir, auth } = await syncRepo(normalizedUrl, token, git);

  const stated = devBranchFrom(await read(dir, DEVOPS_FILE).catch(() => null));
  // Untracked leftovers of an earlier run must not be swept into this step's
  // commit, whichever way the branch was found (bug-002).
  const clean = () => git("git", ["clean", "-fd"], { cwd: dir });

  if (stated?.kind === "named") {
    const branch = stated.branch;
    if (await remoteHasBranch(git, dir, auth, branch)) {
      await checkoutTracking(git, dir, branch, token);
    } else {
      // The repo names a branch the remote does not have yet: create it where
      // the clone stands, exactly as the worker always did for `dev`.
      const created = await git("git", ["checkout", "-B", branch], { cwd: dir });
      if (!created.ok) {
        throw new Error(
          `checkout ${branch} failed: ${redact(created.stderr, [token])}`,
        );
      }
    }
    await clean();
    return { dir, branch };
  }

  let branch: string;
  if (stated?.kind === "current") {
    // The branch the repo itself has checked out — but only when the remote
    // really has it. A purely local one is a leftover of an earlier run here,
    // not this repo's branch.
    const here = await currentBranch(git, dir);
    branch =
      here && (await remoteHasBranch(git, dir, auth, here))
        ? here
        : await defaultBranch(dir, token, deps);
  } else {
    // The repo says nothing: req-013's answer, and no branch is ever created.
    branch = (await remoteHasBranch(git, dir, auth, DEV_BRANCH))
      ? DEV_BRANCH
      : await defaultBranch(dir, token, deps);
  }

  await checkoutTracking(git, dir, branch, token);
  await clean();
  return { dir, branch };
}

/**
 * Clone (or fetch+reset) the repo and check out `dev` (creating it from the
 * default branch if it does not exist). Returns the local path or throws.
 *
 * Since req-020 this is appbaua's OWN checkout only — the source the rollout
 * reads the standard from. Target repos go through prepareRepoOnConvention.
 */
export async function prepareRepo(
  normalizedUrl: string,
  token: string,
  deps: WorkspaceDeps = {},
): Promise<string> {
  const git = deps.runImpl ?? run;
  const { dir, auth } = await syncRepo(normalizedUrl, token, git);

  // Check out dev: track origin/dev if present, else create from current HEAD.
  if (await remoteHasBranch(git, dir, auth, DEV_BRANCH)) {
    await git("git", ["checkout", "-B", DEV_BRANCH, `origin/${DEV_BRANCH}`], {
      cwd: dir,
    });
    await git("git", ["reset", "--hard", `origin/${DEV_BRANCH}`], { cwd: dir });
  } else {
    await git("git", ["checkout", "-B", DEV_BRANCH], { cwd: dir });
  }
  // reset --hard restores tracked files but leaves untracked leftovers of an
  // earlier run lying around, where the next `git add -A` would sweep them into
  // an unrelated commit (bug-002). Start every step from a clean working copy.
  await git("git", ["clean", "-fd"], { cwd: dir });
  return dir;
}

/**
 * The remote's default branch, read from what its HEAD points at — `main`,
 * `master`, or whatever the repo actually uses. Throws when it cannot be read:
 * falling back to a guessed name would create exactly the surprise branch
 * req-013 does away with.
 */
export async function defaultBranch(
  dir: string,
  token: string,
  deps: WorkspaceDeps = {},
): Promise<string> {
  const git = deps.runImpl ?? run;
  const res = await git("git", ["ls-remote", "--symref", "origin", "HEAD"], {
    cwd: dir,
    env: authEnv(token),
  });
  // "ref: refs/heads/master\tHEAD" — the first symref line is the one for HEAD.
  const ref = res.stdout.match(/^ref:\s+refs\/heads\/(\S+)/m);
  if (!res.ok || !ref) {
    throw new Error(
      `default branch unknown: ${redact(res.stderr || res.stdout, [token])}`,
    );
  }
  return ref[1];
}

/**
 * Clone (or fetch+reset) the repo and check out the branch the appbaua rollout
 * writes to (req-013): the repo's own `dev` when it has one, otherwise its
 * default branch. Unlike prepareRepo this NEVER creates a branch — a repo that
 * only has `main` must not end up with a `dev` its owner never asked for.
 * Returns the local path and the branch that was checked out, or throws.
 */
export async function prepareRepoOnDevOrDefault(
  normalizedUrl: string,
  token: string,
  deps: WorkspaceDeps = {},
): Promise<{ dir: string; branch: string }> {
  const git = deps.runImpl ?? run;
  const { dir, auth } = await syncRepo(normalizedUrl, token, git);

  const branch = (await remoteHasBranch(git, dir, auth, DEV_BRANCH))
    ? DEV_BRANCH
    : await defaultBranch(dir, token, deps);

  // Either way the branch already exists on the remote, so both cases are
  // checked out the same way: track it and reset to it.
  await git("git", ["checkout", "-B", branch, `origin/${branch}`], { cwd: dir });
  await git("git", ["reset", "--hard", `origin/${branch}`], { cwd: dir });
  // Same reason as in prepareRepo: untracked leftovers of an earlier run must
  // not be swept into this commit (bug-002).
  await git("git", ["clean", "-fd"], { cwd: dir });
  return { dir, branch };
}

/**
 * Throw away everything uncommitted in the working copy — tracked changes and
 * untracked leftovers alike (bug-002). Used after a failed step, so a
 * half-finished attempt cannot end up in the commit that parks its .md under
 * failed/. Ignored files (node_modules, .env, …) survive: `git clean` without
 * `-x` leaves them alone.
 */
export async function discardChanges(dir: string): Promise<void> {
  await run("git", ["reset", "--hard"], { cwd: dir });
  await run("git", ["clean", "-fd"], { cwd: dir });
}

export type PushOptions = WorkspaceDeps & {
  /**
   * Which branch to push to. Defaults to `dev`, the branch the worker commits
   * on; the appbaua rollout passes the branch it checked out (req-013).
   */
  branch?: string;
};

/**
 * Was this push refused because the remote moved on, rather than for a real
 * reason (no permission, protected branch, missing scope)? Only the first case
 * is worth retrying — git says so in the words below (bug-017).
 */
export function isStaleBranchPush(stderr: string): boolean {
  return /\bfetch first\b|\bnon-fast-forward\b|tip of your current branch is behind/i.test(
    stderr,
  );
}

/** What the Verlauf says when the retry succeeded, appended to the push detail. */
export const REBASED_DETAIL = "nach Rebase auf den neuen Remote-Stand";

/**
 * Stage everything, commit, push to origin/<branch> (`dev` unless told
 * otherwise). Returns false if nothing to commit. The token is needed for the
 * push itself: the remote URL no longer carries it, so the credential has to
 * come along per call (bug-003).
 *
 * A step takes minutes to an hour, and the worker starts it by resetting hard
 * onto the remote. Anything pushed to that branch in the meantime — by the
 * operator, or by a run in another repo that touches the same one — makes the
 * push land on a stale base and git refuses it with "fetch first". Losing a
 * finished step to that is pure waste, so the push is retried ONCE on top of
 * the fresh remote state (bug-017).
 *
 * Rebase, not merge: the worker's commit is the only local one, so replaying it
 * onto the new tip keeps the history linear and produces no merge commit nobody
 * asked for. A rebase that hits a conflict is aborted and reported — two
 * authors changed the same lines, and picking a winner is not the worker's call.
 */
export async function commitAndPush(
  dir: string,
  message: string,
  token: string,
  opts: PushOptions = {},
): Promise<{ pushed: boolean; detail: string }> {
  const git = opts.runImpl ?? run;
  const branch = opts.branch ?? DEV_BRANCH;
  const auth = authEnv(token);
  await git("git", ["add", "-A"], { cwd: dir });
  const status = await git("git", ["status", "--porcelain"], { cwd: dir });
  if (!status.stdout.trim()) {
    return { pushed: false, detail: NO_CHANGES_DETAIL };
  }
  const commit = await git("git", ["commit", "-m", message], { cwd: dir });
  if (!commit.ok) {
    return { pushed: false, detail: `commit failed: ${redact(commit.stderr, [token])}` };
  }

  const push = await git("git", ["push", "origin", branch], { cwd: dir, env: auth });
  if (push.ok) return { pushed: true, detail: `auf ${branch} gepusht` };

  // Anything other than "the remote moved on" is not ours to retry.
  if (!isStaleBranchPush(push.stderr)) {
    return { pushed: false, detail: `push failed: ${redact(push.stderr, [token])}` };
  }

  const fetched = await git("git", ["fetch", "origin", branch], { cwd: dir, env: auth });
  if (!fetched.ok) {
    return { pushed: false, detail: `push failed: ${redact(push.stderr, [token])}` };
  }

  const rebase = await git("git", ["rebase", `origin/${branch}`], { cwd: dir });
  if (!rebase.ok) {
    // Conflicting edits to the same lines. Leave the working copy usable rather
    // than mid-rebase, and report the ORIGINAL rejection — that is what happened.
    await git("git", ["rebase", "--abort"], { cwd: dir });
    return {
      pushed: false,
      detail: `push failed: ${redact(push.stderr, [token])}`,
    };
  }

  const retry = await git("git", ["push", "origin", branch], { cwd: dir, env: auth });
  if (!retry.ok) {
    return { pushed: false, detail: `push failed: ${redact(retry.stderr, [token])}` };
  }
  return { pushed: true, detail: `auf ${branch} gepusht (${REBASED_DETAIL})` };
}

/**
 * Short SHA of the current HEAD, or null when it cannot be read. Used to say
 * which state of the repo a filed report describes (req-010); a missing SHA
 * must never fail the step, so this never throws.
 */
export async function headCommit(dir: string): Promise<string | null> {
  const res = await run("git", ["rev-parse", "--short", "HEAD"], { cwd: dir });
  const sha = res.stdout.trim();
  return res.ok && sha ? sha : null;
}

/**
 * Write a file inside the repo working copy, creating its folder if needed
 * (req-010). The next commitAndPush picks it up like any other change.
 */
export async function writeRepoFile(
  dir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const target = path.join(dir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

/** Move a file from ready/ to done|failed/ inside the repo working copy. */
export async function moveMd(
  dir: string,
  fromRel: string,
  toRel: string,
): Promise<void> {
  const from = path.join(dir, fromRel);
  const to = path.join(dir, toRel);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

export async function listReady(dir: string, readyRel: string): Promise<string[]> {
  try {
    return await fs.readdir(path.join(dir, readyRel));
  } catch {
    return [];
  }
}

/**
 * Every folder and file below `rel`, as repo-relative paths, sorted (req-012).
 * This is what makes the appbaua rollout read its source at runtime instead of
 * carrying a hardcoded list: whatever `.claude/skills/` and `delivery/` contain
 * on the day it runs is what gets rolled out.
 *
 * A missing `rel` yields empty lists rather than an error — a source repo
 * without one of the two folders simply rolls out nothing from it. Symlinks are
 * ignored: neither branch of the walk claims them, so nothing outside the
 * working copy can be pulled in through one.
 */
export async function listTree(
  dir: string,
  rel: string,
): Promise<{ dirs: string[]; files: string[] }> {
  const dirs: string[] = [];
  const files: string[] = [];

  const walk = async (current: string): Promise<void> => {
    // Missing or unreadable folder: nothing to roll out from it.
    const entries = await fs
      .readdir(path.join(dir, current), { withFileTypes: true })
      .catch(() => null);
    if (!entries) return;
    for (const entry of entries) {
      const childRel = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        dirs.push(childRel);
        await walk(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  };

  await walk(rel);
  dirs.sort();
  files.sort();
  return { dirs, files };
}

/** Does `rel` exist inside the working copy (file or folder)? */
export async function repoPathExists(dir: string, rel: string): Promise<boolean> {
  return fs
    .stat(path.join(dir, rel))
    .then(() => true)
    .catch(() => false);
}

/** Create `rel` and its parents inside the working copy. */
export async function ensureRepoDir(dir: string, rel: string): Promise<void> {
  await fs.mkdir(path.join(dir, rel), { recursive: true });
}

/** Read a file from the working copy, or null when it is not there. */
export async function readRepoFile(
  dir: string,
  rel: string,
): Promise<string | null> {
  return fs.readFile(path.join(dir, rel), "utf8").catch(() => null);
}

/**
 * Copy one file from one working copy into another, creating the target folder
 * and overwriting a file of the same name (req-012).
 */
export async function copyRepoFile(
  fromDir: string,
  fromRel: string,
  toDir: string,
  toRel: string,
): Promise<void> {
  const target = path.join(toDir, toRel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(fromDir, fromRel), target);
}
