// Which branch the worker commits on in a TARGET repo (req-020).
//
// Until now every step checked `dev` out and created it where the repo had
// none. That fits repos built to the appbaua standard and quietly breaks every
// repo that deliberately uses a different convention: the worker landed on a
// `dev` it had just branched off the default branch, found none of the work
// waiting on the repo's real branch, skipped, and paused — without a single
// line in the Verlauf.
//
// So the convention is no longer this worker's. It belongs to the target repo,
// and the repo states it in its own `delivery/devops.md`. Its `## Environments`
// table is a machine contract of the setup-devops skill (the heading, the `dev`
// row and the Branch column stay put in every language), which is why the
// branch can be read out of it — the same contract the doc screenshots read
// the dev URL from (req-017), which is why both read it through the row helper
// below instead of each parsing the table their own way.

/**
 * The repo file that names the app's environments — its branches and its URLs.
 * Lives here because the branch is what the worker needs on EVERY step, while
 * the URL (req-017) is only the Doku task's business.
 */
export const DEVOPS_FILE = "delivery/devops.md";

/**
 * What a repo's devops.md says about the branch its dev environment lives on.
 *
 * `named`   — a concrete branch, e.g. `dev` or `develop`: the worker uses it.
 * `current` — a convention instead of a name, e.g. "aktueller `feature/*`-
 *             Branch": there IS no fixed branch to check out, so the worker
 *             stays on the branch the repo currently has checked out and
 *             creates nothing.
 *
 * `null` (no devops.md, no Environments section, no dev row, an unfilled
 * placeholder) is not part of this type: it means "the repo says nothing", and
 * the caller then keeps the behaviour of req-013 — `dev` if the repo has one,
 * otherwise its default branch.
 */
export type DevBranch =
  | { kind: "named"; branch: string }
  | { kind: "current" };

/** The `## Environments` section of devops.md — a machine contract per the skill. */
const ENV_HEADING = /^#{1,6}\s+.*(environments|umgebungen)/i;
const ANY_HEADING = /^#{1,6}\s/;
/** The header cell that marks the Branch column, whatever its position is. */
const BRANCH_HEADER = /^(branch|zweig)$/i;
/** An unfilled template placeholder, e.g. `<TODO: branch>` — says nothing. */
const TODO_CELL = /\btodo\b/i;
/**
 * A bare branch name and nothing else. `*` is deliberately outside the class:
 * `feature/*` is a PATTERN, and a pattern is a convention, not a branch to
 * check out.
 */
const PLAIN_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
/** The first backticked token of a cell — how a hand-written row quotes a name. */
const BACKTICKED = /`([^`]+)`/;

/**
 * Read one table cell as a bare value: strips the decoration a hand-written line
 * carries (backticks, quotes, an autolink's angle brackets, a markdown link, a
 * trailing period). What is left is only accepted as a URL or a branch if it
 * really looks like one, which is what makes the skill's own `<TODO: …>`
 * placeholders count as "not stated" rather than as a host or a branch called
 * TODO.
 */
export function cellValue(raw: string): string {
  let v = raw.trim();
  const link = v.match(/\[[^\]]*\]\(([^)]+)\)/);
  if (link) v = link[1];
  return v
    .replace(/[`"'<>]/g, "")
    .trim()
    .replace(/[.,;]+$/, "")
    .trim();
}

export type EnvironmentRow = {
  /** The row's cells, undecorated (see cellValue). */
  cells: string[];
  /** The same cells as they stand in the file — needed to see the backticks. */
  raw: string[];
  /** The table's header cells, or empty when the table has no header row. */
  header: string[];
};

/**
 * The `## Environments` row for one environment, or null when the repo's
 * devops.md names none — no file, no Environments section, no such row.
 *
 * Only that one section is read, so a URL or a branch mentioned in the prose
 * below it can never be mistaken for an environment — and only the row that is
 * asked for, so the prod row one line below can never stand in for the dev one.
 */
export function environmentRow(
  devops: string | null | undefined,
  env: string,
): EnvironmentRow | null {
  if (!devops) return null;
  const lines = devops.split("\n");
  const start = lines.findIndex((l) => ENV_HEADING.test(l.trim()));
  if (start < 0) return null;

  const wanted = env.toLowerCase();
  let header: string[] | null = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (ANY_HEADING.test(line)) break; // next section: the table is over
    if (!line.startsWith("|")) continue;
    const raw = line.split("|").slice(1, -1);
    if (raw.length < 2) continue;
    const cells = raw.map(cellValue);
    // The first table row is the header — unless it is already the row we are
    // looking for, which is what a hand-written table without one looks like.
    const isFirst = header === null;
    if (isFirst) header = cells;
    if (cells[0].toLowerCase() !== wanted) continue; // separator, prod row, …
    return { cells, raw, header: isFirst ? [] : (header ?? []) };
  }
  return null;
}

/** Is this a branch a `git checkout` could be handed, and nothing else? */
export function isBranchName(value: string): boolean {
  return (
    PLAIN_BRANCH.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/") &&
    !value.endsWith(".")
  );
}

/** Which column holds the branch — read off the header, second column by default. */
function branchColumn(header: string[]): number {
  const i = header.findIndex((h) => BRANCH_HEADER.test(h));
  return i >= 0 ? i : 1;
}

/**
 * What the repo's devops.md says the worker should commit on (req-020), or null
 * when it says nothing usable.
 *
 * A cell that is a bare name — `dev`, `develop`, `` `main` `` — is that branch.
 * A cell that describes a convention around a pattern — "aktueller
 * `feature/*`-Branch" — names no branch to check out, so it comes back as
 * `current`: the worker stays where the repo is instead of forcing a branch of
 * its own onto it. A cell that quotes exactly one real name inside prose is
 * still that name; the quoting is how such a row is written by hand.
 */
export function devBranchFrom(
  devops: string | null | undefined,
): DevBranch | null {
  const row = environmentRow(devops, "dev");
  if (!row) return null;

  const column = branchColumn(row.header);
  const value = row.cells[column] ?? "";
  if (!value || TODO_CELL.test(value)) return null;

  const quoted = (row.raw[column] ?? "").match(BACKTICKED);
  const candidate = quoted ? cellValue(quoted[1]) : value;
  return isBranchName(candidate)
    ? { kind: "named", branch: candidate }
    : { kind: "current" };
}
