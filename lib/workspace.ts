import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { redact } from "./redact";

/** What commitAndPush reports when the working copy holds nothing to commit. */
export const NO_CHANGES_DETAIL = "keine Aenderungen";

// Git workspace helpers for req-006. Clones/updates a target repo into a work
// dir using the GitHub token for auth, and ensures the `dev` branch. All git
// runs shell out; process output is captured for logging.
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

/**
 * Clone (or fetch+reset) the repo and check out `dev` (creating it from the
 * default branch if it does not exist). Returns the local path or throws.
 */
export async function prepareRepo(
  normalizedUrl: string,
  token: string,
  deps: WorkspaceDeps = {},
): Promise<string> {
  const git = deps.runImpl ?? run;
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

  // Check out dev: track origin/dev if present, else create from current HEAD.
  const hasRemoteDev = await git("git", ["ls-remote", "--exit-code", "origin", "dev"], {
    cwd: dir,
    env: auth,
  });
  if (hasRemoteDev.ok) {
    await git("git", ["checkout", "-B", "dev", "origin/dev"], { cwd: dir });
    await git("git", ["reset", "--hard", "origin/dev"], { cwd: dir });
  } else {
    await git("git", ["checkout", "-B", "dev"], { cwd: dir });
  }
  // reset --hard restores tracked files but leaves untracked leftovers of an
  // earlier run lying around, where the next `git add -A` would sweep them into
  // an unrelated commit (bug-002). Start every step from a clean working copy.
  await git("git", ["clean", "-fd"], { cwd: dir });
  return dir;
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

/**
 * Stage everything, commit, push to origin/dev. Returns false if nothing to
 * commit. The token is needed for the push itself: the remote URL no longer
 * carries it, so the credential has to come along per call (bug-003).
 */
export async function commitAndPush(
  dir: string,
  message: string,
  token: string,
  deps: WorkspaceDeps = {},
): Promise<{ pushed: boolean; detail: string }> {
  const git = deps.runImpl ?? run;
  await git("git", ["add", "-A"], { cwd: dir });
  const status = await git("git", ["status", "--porcelain"], { cwd: dir });
  if (!status.stdout.trim()) {
    return { pushed: false, detail: NO_CHANGES_DETAIL };
  }
  const commit = await git("git", ["commit", "-m", message], { cwd: dir });
  if (!commit.ok) {
    return { pushed: false, detail: `commit failed: ${redact(commit.stderr, [token])}` };
  }
  const push = await git("git", ["push", "origin", "dev"], {
    cwd: dir,
    env: authEnv(token),
  });
  if (!push.ok) {
    return { pushed: false, detail: `push failed: ${redact(push.stderr, [token])}` };
  }
  return { pushed: true, detail: "auf dev gepusht" };
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
