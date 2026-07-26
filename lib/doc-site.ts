// Everything the Doku task needs to be a task type of its own (req-016). Pure
// string logic — no git, no fs — so the folder convention and the "is there a
// design template?" decision are unit-testable on their own.
//
// Why its own module next to security-report: the Doku task produces neither
// code nor a report but a multi-page website under site/user-docs/, and it only
// runs at all when the repo points it at a design template. Where that template
// lives is not fixed by the worker — it stands in the repo's own
// delivery/doc-site.md, written by the setup-doc-site skill — so reading that
// pointer out of a markdown file is logic of its own.

/**
 * The repo's doc-site spec: where the design template lives and where the docs
 * deploy to. The user maintains it via the setup-doc-site skill; the worker only
 * reads it. Without it the Doku task does nothing.
 */
export const DOC_SITE_FILE = "delivery/doc-site.md";

/** Common web output root in the repo; site/tech-docs and site/www join it later. */
export const SITE_ROOT = "site";

/** Where the generated user documentation lives (req-016). */
export const USER_DOCS_DIR = `${SITE_ROOT}/user-docs`;

/** What the docs are written from: the requirements that were actually shipped. */
export const DONE_REQUIREMENTS_DIR = "delivery/requirements/done";

/**
 * What the worker logs when the repo has no design template. Such a run does
 * NOTHING — no Claude call, no file, no commit — because req-016 makes the
 * template the precondition of the whole task, not a nice-to-have.
 */
export const NO_DESIGN_MESSAGE = "keine Design-Vorgabe hinterlegt";

/**
 * What the worker logs when a run left the docs as they were. Not a failure: an
 * incremental update that finds nothing to add is the normal case on a day
 * without new requirements.
 */
export const DOC_UNCHANGED_MESSAGE = "Doku unverändert";

/** The `## Design-Vorlage` section of doc-site.md — a machine contract per the skill. */
const DESIGN_HEADING = /^#{1,6}\s+.*design-vorlage/i;
const ANY_HEADING = /^#{1,6}\s/;
/** A list item, `-` or `*`. Everything the section says stands in one. */
const BULLET = /^[-*]\s+(.*)$/;
/** "Ort: <value>" — the label may be translated, so only its shape is fixed. */
const LABELLED = /^[^:]{1,40}:\s*(.+)$/;
/** A repo-relative path and nothing else: no spaces, no prose, no URL scheme. */
const REPO_PATH = /^[A-Za-z0-9._@-]+(\/[A-Za-z0-9._@-]+)*$/;

/**
 * Read one bullet's value as a repo-relative folder path, or null when it is not
 * one. Strips the decoration a hand-written line may carry (backticks, quotes, a
 * markdown link, a trailing slash or period) and then insists on a plain
 * relative path.
 *
 * Rejecting everything else is what makes the template's own placeholder
 * ("<Ordnerpfad, z.B. delivery/doc-design/>") count as "no template" rather than
 * as a folder named after the placeholder. Absolute paths and `..` segments are
 * rejected too: this value ends up in a path the worker looks at inside the
 * working copy, and nothing outside it is ever the design template.
 */
function asRepoPath(raw: string): string | null {
  let v = raw.trim();
  const link = v.match(/\[[^\]]*\]\(([^)]+)\)/);
  if (link) v = link[1];
  v = v
    .replace(/[`"']/g, "")
    .trim()
    .replace(/[.,;]+$/, "")
    .trim()
    .replace(/\/+$/, "");
  if (!v || !REPO_PATH.test(v)) return null;
  if (v.split("/").includes("..")) return null;
  return v;
}

/**
 * Where the design template lies according to the repo's doc-site.md, or null
 * when the file names no usable location — missing file, missing section,
 * unfilled template placeholder. Null is the answer that makes the Doku task do
 * nothing (req-016).
 *
 * Only the `## Design-Vorlage` section is read, so the deploy hosts further down
 * can never be mistaken for the template. Within it, the first bullet whose
 * value is a plain relative path wins — the bullet's label ("Ort:") is written
 * in the user's language and cannot be relied on, its value cannot be anything
 * but a path.
 */
export function designDirFrom(docSite: string | null | undefined): string | null {
  if (!docSite) return null;
  const lines = docSite.split("\n");
  const start = lines.findIndex((l) => DESIGN_HEADING.test(l.trim()));
  if (start < 0) return null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (ANY_HEADING.test(line)) break; // next section: the template's own is over
    const bullet = line.match(BULLET);
    if (!bullet) continue;
    // With a label ("Ort: x") the value is what follows it; without one the
    // whole bullet is the value. Both are tried, because a bullet can carry a
    // colon without the part before it being a label.
    const labelled = bullet[1].match(LABELLED);
    const path =
      (labelled && asRepoPath(labelled[1])) || asRepoPath(bullet[1]);
    if (path) return path;
  }
  return null;
}
