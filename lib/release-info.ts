import { isoDate, slugify } from "./review-report";

// Wo und wie der Worker die Release-Info eines abgeschlossenen Pakets im
// Ziel-Repo ablegt (req-046). Pure Logik — kein Git, kein fs — wie
// review-report.ts und security-report.ts.
//
// Die Release-Info entsteht im selben Lauf, der das Paket abschließt: Claude
// beendet seine letzte Antwort auf fileTaskPrompt mit dem Marker
// RELEASE_INFO_MARKER, gefolgt vom Text für den Betreiber (claude-runner.ts).
// execute-step.ts liest das aus `outcome.report` heraus und schreibt es
// deterministisch in diese Datei — nie nachträglich aus dem Verlauf.

/** Fixed folder in the target repo that collects the release infos. */
export const RELEASE_INFO_DIR = "delivery/release-info";

/** Marker, mit dem Claude seine Antwort beendet, um die Release-Info vom
 * Rest der Antwort zu trennen (claude-runner.ts: fileTaskPrompt). */
export const RELEASE_INFO_MARKER = "RELEASE-INFO:";

export type ReleaseInfoRef = {
  /** Display name of the repo, e.g. "appbaua". */
  repoName: string;
  /** .md-Name ohne Endung, z.B. "req-046-release-infos-je-paket". */
  packageId: string;
  now: Date;
};

/**
 * Pulls the text after RELEASE_INFO_MARKER out of Claude's final answer, or
 * null when the marker is missing (Claude did not follow the instruction, or
 * this is some other kind of run). Only the LAST occurrence counts, so a
 * marker quoted earlier in the answer cannot be mistaken for the real one.
 */
export function extractReleaseInfo(report: string): string | null {
  const idx = report.lastIndexOf(RELEASE_INFO_MARKER);
  if (idx === -1) return null;
  const text = report.slice(idx + RELEASE_INFO_MARKER.length).trim();
  return text || null;
}

/** A slug that is never empty, so no filename part silently disappears. */
function part(value: string, fallback: string): string {
  return slugify(value) || fallback;
}

export function releaseInfoFileName(ref: ReleaseInfoRef): string {
  return `${isoDate(ref.now)}-${part(ref.packageId, "paket")}.md`;
}

export function releaseInfoPath(
  ref: ReleaseInfoRef,
  dir: string = RELEASE_INFO_DIR,
): string {
  return `${dir}/${releaseInfoFileName(ref)}`;
}

/**
 * The file content: a short front matter block (repo/package/date) so a
 * reader can tell entries apart, then the text verbatim.
 */
export function releaseInfoContent(doc: ReleaseInfoRef & { text: string }): string {
  const header = [
    "---",
    `repo: ${doc.repoName}`,
    `package: ${doc.packageId}`,
    `date: ${isoDate(doc.now)}`,
    "---",
    "",
  ];
  return `${header.join("\n")}${doc.text.trim()}\n`;
}

export type ParsedReleaseInfo = {
  repoName: string;
  packageId: string;
  date: string;
  text: string;
};

/**
 * Reads a filed release info back (front matter + text). Null for anything
 * that is not in the shape releaseInfoContent produces — a file that cannot
 * be parsed is skipped by the reader, not shown broken.
 */
export function parseReleaseInfo(raw: string): ParsedReleaseInfo | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  if (!fields.repo || !fields.package || !fields.date) return null;
  return {
    repoName: fields.repo,
    packageId: fields.package,
    date: fields.date,
    text: m[2].trim(),
  };
}
