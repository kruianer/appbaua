import { getStore } from "./store";
import {
  type Repo,
  type RepoModel,
  DEFAULT_REPO_MODEL,
  deriveName,
  isDuplicate,
  normalizeUrl,
} from "./repos";
import { checkReachable } from "./reachability";
import {
  type ConvertResult,
  type ConvertSummary,
  queueAppbauaStandard,
} from "./appbaua-standard";

// Application service: the operations req-001 exposes. Routes stay thin and
// call these; tests exercise them directly. Reachability is injected so tests
// don't hit the network.

export type AddResult =
  | { ok: true; repo: Repo; repos: Repo[] }
  | { ok: false; error: "duplicate" | "unreachable" | "empty" };

let counter = 0;
function newId(): string {
  // Date.now avoided in workflow scripts, but here we're in normal runtime.
  counter += 1;
  return `r${Date.now()}${counter}`;
}

export async function listRepos(): Promise<Repo[]> {
  return getStore().list();
}

export async function addRepo(
  input: { url: string; name?: string },
  deps?: {
    checkReachable?: typeof checkReachable;
  },
): Promise<AddResult> {
  const raw = (input.url ?? "").trim();
  if (!raw) return { ok: false, error: "empty" };

  const normalized = normalizeUrl(raw);
  const repos = await getStore().list();
  if (isDuplicate(repos, normalized)) return { ok: false, error: "duplicate" };

  const check = (deps?.checkReachable ?? checkReachable)(raw);
  const reach = await check;
  if (!reach.ok) return { ok: false, error: "unreachable" };

  const name = (input.name ?? "").trim() || deriveName(normalized);
  const repo: Repo = {
    id: newId(),
    name,
    url: normalized,
    active: true,
    model: DEFAULT_REPO_MODEL,
    // req-032: watching an app reaches into a live system, so it starts off.
    monitored: false,
  };
  const next = [...repos, repo]; // append = lowest priority
  await getStore().replace(next);
  return { ok: true, repo, repos: next };
}

export async function toggleRepo(id: string): Promise<Repo[]> {
  const repos = await getStore().list();
  const next = repos.map((r) =>
    r.id === id ? { ...r, active: !r.active } : r,
  );
  return getStore().replace(next);
}

/**
 * Flip the "überwachen" switch of one repo (req-032). Separate from
 * toggleRepo: whether the worker WORKS on a repo and whether appbaua WATCHES
 * its app are two independent decisions.
 */
export async function toggleRepoMonitored(id: string): Promise<Repo[]> {
  const repos = await getStore().list();
  const next = repos.map((r) =>
    r.id === id ? { ...r, monitored: !r.monitored } : r,
  );
  return getStore().replace(next);
}

/** Set the model this repo's Claude Code calls use (req-028). */
export async function setRepoModel(
  id: string,
  model: RepoModel,
): Promise<Repo[]> {
  const repos = await getStore().list();
  const next = repos.map((r) => (r.id === id ? { ...r, model } : r));
  return getStore().replace(next);
}

export async function removeRepo(id: string): Promise<Repo[]> {
  const repos = await getStore().list();
  const next = repos.filter((r) => r.id !== id);
  return getStore().replace(next);
}

export type ConvertRepoResult =
  | { ok: true; message: string; summary: ConvertSummary }
  | { ok: false; error: string; notFound?: boolean };

/**
 * Bring the repo with this id up to the appbaua standard (req-012). The lookup
 * and the unknown-id case belong to the operation, not to the HTTP layer, so the
 * route above it stays plain glue. The rollout itself is injectable for tests.
 */
export async function convertRepoToAppbaua(
  id: string,
  deps?: { rollOut?: (targetUrl: string) => Promise<ConvertResult> },
): Promise<ConvertRepoResult> {
  const repos = await getStore().list();
  const repo = repos.find((r) => r.id === id);
  if (!repo) {
    return { ok: false, error: "Repo nicht gefunden.", notFound: true };
  }

  const result = await (deps?.rollOut ?? queueAppbauaStandard)(repo.url);
  return result.ok
    ? { ok: true, message: result.message, summary: result.summary }
    : { ok: false, error: result.error };
}

/** Reorder to exactly the given id order (order = priority, index 0 = highest). */
export async function reorderRepos(orderedIds: string[]): Promise<Repo[]> {
  const repos = await getStore().list();
  const byId = new Map(repos.map((r) => [r.id, r]));
  const next: Repo[] = [];
  for (const id of orderedIds) {
    const r = byId.get(id);
    if (r) {
      next.push(r);
      byId.delete(id);
    }
  }
  // Any ids not mentioned keep their relative order at the end (defensive).
  for (const r of repos) if (byId.has(r.id)) next.push(r);
  return getStore().replace(next);
}
