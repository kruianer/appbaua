import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// Git workspace helpers for req-006. Clones/updates a target repo into a work
// dir using the GitHub token for auth, and ensures the `dev` branch. All git
// runs shell out; process output is captured for logging.

const WORK_ROOT = process.env.WORKER_WORKDIR || "/tmp/appbaua-work";

export type RunResult = { ok: boolean; code: number; stdout: string; stderr: string };

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
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
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
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

/** Build an https clone URL carrying the token, from a normalized repo url. */
export function tokenUrl(normalizedUrl: string, token: string): string {
  // normalizedUrl is like github.com/owner/repo
  return `https://x-access-token:${token}@${normalizedUrl}.git`;
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
): Promise<string> {
  const dir = repoDir(normalizedUrl);
  const url = tokenUrl(normalizedUrl, token);
  await fs.mkdir(WORK_ROOT, { recursive: true });

  const exists = await fs
    .stat(path.join(dir, ".git"))
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    const clone = await run("git", ["clone", url, dir]);
    if (!clone.ok) throw new Error(`clone failed: ${clone.stderr}`);
  } else {
    await run("git", ["remote", "set-url", "origin", url], { cwd: dir });
    const fetch = await run("git", ["fetch", "origin"], { cwd: dir });
    if (!fetch.ok) throw new Error(`fetch failed: ${fetch.stderr}`);
  }

  // Ensure identity so commits succeed in a fresh container.
  await run("git", ["config", "user.email", "worker@appbaua.local"], { cwd: dir });
  await run("git", ["config", "user.name", "appbaua-worker"], { cwd: dir });

  // Check out dev: track origin/dev if present, else create from current HEAD.
  const hasRemoteDev = await run("git", ["ls-remote", "--exit-code", "origin", "dev"], { cwd: dir });
  if (hasRemoteDev.ok) {
    await run("git", ["checkout", "-B", "dev", "origin/dev"], { cwd: dir });
    await run("git", ["reset", "--hard", "origin/dev"], { cwd: dir });
  } else {
    await run("git", ["checkout", "-B", "dev"], { cwd: dir });
  }
  return dir;
}

/** Stage everything, commit, push to origin/dev. Returns false if nothing to commit. */
export async function commitAndPush(
  dir: string,
  message: string,
): Promise<{ pushed: boolean; detail: string }> {
  await run("git", ["add", "-A"], { cwd: dir });
  const status = await run("git", ["status", "--porcelain"], { cwd: dir });
  if (!status.stdout.trim()) {
    return { pushed: false, detail: "keine Aenderungen" };
  }
  const commit = await run("git", ["commit", "-m", message], { cwd: dir });
  if (!commit.ok) return { pushed: false, detail: `commit failed: ${commit.stderr}` };
  const push = await run("git", ["push", "origin", "dev"], { cwd: dir });
  if (!push.ok) return { pushed: false, detail: `push failed: ${push.stderr}` };
  return { pushed: true, detail: "auf dev gepusht" };
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
