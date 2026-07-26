// Where the report of a recurring analysis task lands in the target repo
// (req-010). Pure string logic — no git, no fs — so the naming convention is
// unit-testable on its own.
//
// Why: a Code-Review, Security-Review or Doku run produces a long report that
// used to exist only in the throwaway Claude session in the container and,
// truncated, in the run-log message (req-004). Filing it as a markdown file in
// the repo makes it re-readable later; the run log keeps its short message.

/** Fixed folder in the target repo that collects the worker's reports. */
export const REPORT_DIR = "delivery/reviews";

/** What a report refers to; drives both its filename and its front matter. */
export type ReportRef = {
  /** Stable task-type slug, e.g. "code-review" (the req-002 ids). */
  taskId: string;
  /** Display name of the analysed repo, e.g. "appbaua". */
  repoName: string;
  /** Short commit the report describes; null when it cannot be determined. */
  commit: string | null;
  /** When the report was produced. */
  now: Date;
};

export type ReportDoc = ReportRef & {
  /** Display label of the task type, e.g. "Code-Review". */
  taskLabel: string;
  /** Claude's complete final answer — the report itself. */
  report: string;
};

/**
 * Reduce a free-form value (task-type id, repo name, commit) to a safe filename
 * part. Everything that is not a letter or digit becomes a single dash, which
 * also makes it impossible for an oddly configured id like "../../etc" to point
 * outside REPORT_DIR.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Local calendar date as YYYY-MM-DD, so reports sort chronologically. */
export function isoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A slug that is never empty, so no filename part silently disappears. */
function part(value: string, fallback: string): string {
  return slugify(value) || fallback;
}

/**
 * Filename of a report: date, type, repo and commit, in that order. Those are
 * exactly the things you need to recognize a report in a folder listing, and
 * the leading date makes the listing sort oldest-first.
 */
export function reportFileName(ref: ReportRef): string {
  const parts = [
    isoDate(ref.now),
    part(ref.taskId, "task"),
    part(ref.repoName, "repo"),
  ];
  const commit = ref.commit ? slugify(ref.commit) : "";
  if (commit) parts.push(commit);
  return `${parts.join("-")}.md`;
}

/**
 * Repo-relative path the report is written to. The folder is a parameter
 * because not every report is a review: the Security task files into its own
 * folder (req-014) with the same naming rules.
 */
export function reportPath(ref: ReportRef, dir: string = REPORT_DIR): string {
  return `${dir}/${reportFileName(ref)}`;
}

/**
 * The file content: a short front matter block repeating type/repo/commit/date
 * in machine-readable form, then Claude's report verbatim. The report's own
 * format is deliberately not prescribed (req-010) — Claude writes it freely.
 */
export function reportContent(doc: ReportDoc): string {
  const commit = doc.commit ?? "unbekannt";
  const header = [
    "---",
    `type: ${doc.taskId}`,
    `repo: ${doc.repoName}`,
    `commit: ${commit}`,
    `date: ${isoDate(doc.now)}`,
    "---",
    "",
    `# ${doc.taskLabel}: ${doc.repoName} (${commit})`,
    "",
    `Automatisch erstellt vom appbaua-Worker am ${isoDate(doc.now)}.`,
    "",
    "",
  ];
  return `${header.join("\n")}${doc.report.trim()}\n`;
}
