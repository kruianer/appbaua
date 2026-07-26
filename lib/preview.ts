import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import { planPreview, type PreviewEntry } from "./scheduling";
import { sourceFor, readyDir, oldestMd } from "./task-source";
import { RECURRING_MD_LABEL } from "./run-log";
import { prepareRepoOnConvention, listReady } from "./workspace";

// Builds the "Nächste Aktivitäten" look-ahead (req-022): not just which
// repo × task type is next, but the ACTUAL file waiting for it — so the
// preview shows what really is about to happen, not a category guess. That
// means cloning each active repo once and reading its ready/ folder, the
// same thing execute-step does right before a step actually runs.
//
// Deliberately NOT run on every page load: cloning every active repo on a
// browser poll would be expensive and pointless if nothing changed. Instead
// the worker loop builds this after every pass — a real execution or an idle
// check (req-029's rate-limit pause aside, see worker-loop) — and the result
// is read like any other status field.

/** One row of the preview, with the concrete filename resolved (req-022). */
export type PreviewRow = {
  repo: string;
  taskType: string;
  /** The waiting file's name, or the recurring placeholder — never null. */
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
 * Resolve one entry's filename: the oldest waiting .md for a file-driven type,
 * the recurring placeholder for everything else. Null means "nothing waiting"
 * — a file-driven type with an empty ready/ has no row to show, exactly like
 * execute-step silently skips it.
 */
async function resolveMd(
  entry: PreviewEntry,
  dir: string,
  deps: PreviewDeps,
): Promise<string | null> {
  const src = sourceFor(entry.taskType.id);
  if (src.kind !== "file" || !src.base) return RECURRING_MD_LABEL;
  const files = await deps.listReady(dir, readyDir(src.base));
  return oldestMd(files);
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
  const entries = planPreview(repos, taskTypes, now);

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

    const mdName = await resolveMd(entry, dir, d);
    if (!mdName) continue; // file-driven with nothing waiting: no row

    rows.push({
      repo: entry.repo.name,
      taskType: entry.taskType.label,
      mdName,
      due:
        entry.due.kind === "queue"
          ? entry.due
          : { kind: "at", at: entry.due.at.toISOString() },
    });
  }
  return rows;
}
