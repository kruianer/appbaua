import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import { planPreview, type PreviewEntry } from "./scheduling";
import { sourceFor, readyDir, sortedMds } from "./task-source";
import { prepareRepoOnConvention, listReady } from "./workspace";

// Builds the "Nächste Aktivitäten" look-ahead (req-022): not just which
// repo × task type is next, but the ACTUAL files waiting for it — so the
// preview shows what really is about to happen, not a category guess. That
// means cloning each active repo once and reading its ready/ folder, the
// same thing execute-step does right before a step actually runs.
//
// Only bugs and requirements show here (bug-025): they are what the operator
// actually wants a look-ahead on. Recurring task types (Security, Doku,
// Ideen, Code-Review) have no file backlog to preview and used to drown out
// the repos' real work, so they are filtered out before planPreview even
// sees them — they stay visible in the Verlauf, just not here.
//
// Deliberately NOT run on every page load: cloning every active repo on a
// browser poll would be expensive and pointless if nothing changed. Instead
// the worker loop builds this after every pass — a real execution or an idle
// check (req-029's rate-limit pause aside, see worker-loop) — and the result
// is read like any other status field.

/**
 * One row of the preview, one per waiting file (req-022, bug-025): a repo ×
 * task type with three files waiting is three rows, not one, so the list
 * shows the real backlog instead of just the next file in line.
 */
export type PreviewRow = {
  repo: string;
  taskType: string;
  mdName: string;
  due:
    | { kind: "queue"; position: number }
    | { kind: "at"; at: string }; // ISO
};

export type PreviewDeps = {
  prepareRepo: (url: string, token: string) => Promise<{ dir: string }>;
  listReady: typeof listReady;
};

const defaultDeps: PreviewDeps = {
  prepareRepo: prepareRepoOnConvention,
  listReady,
};

/**
 * All of one entry's waiting .md files, oldest first — empty when the
 * ready/ folder has nothing, exactly like execute-step silently skips it.
 * Only called for file-driven entries; `buildPreview` filters out every
 * other kind before this runs.
 */
async function waitingMds(
  entry: PreviewEntry,
  dir: string,
  deps: PreviewDeps,
): Promise<string[]> {
  const src = sourceFor(entry.taskType.id);
  if (src.kind !== "file" || !src.base) return [];
  const files = await deps.listReady(dir, readyDir(src.base));
  return sortedMds(files);
}

/**
 * Build the full preview for the currently active repos/task types. Clones
 * each active repo at most once — the same working copy answers every task
 * type it has entries for — and never throws: a repo that cannot be prepared
 * simply contributes no rows (its trouble already shows up as a Verlauf error
 * from the real run, req-020).
 */
export async function buildPreview(
  repos: Repo[],
  taskTypes: TaskType[],
  now: Date,
  token: string,
  deps: Partial<PreviewDeps> = {},
): Promise<PreviewRow[]> {
  const d: PreviewDeps = { ...defaultDeps, ...deps };
  const fileDrivenTypes = taskTypes.filter((t) => sourceFor(t.id).kind === "file");
  const entries = planPreview(repos, fileDrivenTypes, now);

  const dirByRepoId = new Map<string, string | null>();
  const rows: PreviewRow[] = [];
  for (const entry of entries) {
    if (!dirByRepoId.has(entry.repo.id)) {
      try {
        const prepared = await d.prepareRepo(entry.repo.url, token);
        dirByRepoId.set(entry.repo.id, prepared.dir);
      } catch {
        dirByRepoId.set(entry.repo.id, null); // unreachable: contributes no rows
      }
    }
    const dir = dirByRepoId.get(entry.repo.id);
    if (!dir) continue;

    const mdNames = await waitingMds(entry, dir, d);
    const due: PreviewRow["due"] =
      entry.due.kind === "queue"
        ? entry.due
        : { kind: "at", at: entry.due.at.toISOString() };
    for (const mdName of mdNames) {
      rows.push({ repo: entry.repo.name, taskType: entry.taskType.label, mdName, due });
    }
  }
  return rows;
}
