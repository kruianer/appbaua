// req-036: Ein Requirement in Etappen abarbeiten, statt in einem Zug. Eine
// Etappe ist ein Akzeptanzkriterium — die Kästchen, die in jeder .md ohnehin
// stehen.
//
// Warum diese Grenze und keine zeitliche: Ein Schnitt nach Minuten trifft
// mitten in eine halbfertige Änderung. Ein Kriterium ist ein fachlich ganzer
// Schritt; ist es erfüllt und die Suite grün, ist der Stand für sich sinnvoll.
//
// Und warum die Häkchen als Gedächtnis: Sie stehen schon da, sie werden
// mitcommittet, und sie sind auch für den Menschen lesbar. Die Alternative
// wäre gewesen, Commit-Nachrichten zu deuten — die aber durch eigene Commits
// des Betreibers durchmischt und durch ein Rebase umgeschrieben werden.

/** Ein Kästchen am Zeilenanfang, wie es die Requirement-Vorlage schreibt. */
const CRITERION_LINE = /^(\s*)-\s*\[( |x|X)\]\s*(.*)$/;

/** Die Überschrift, unter der die Kriterien stehen. */
const CRITERIA_HEADING = /^#{1,6}\s+.*(acceptance criteria|akzeptanzkriterien)/i;
const ANY_HEADING = /^#{1,6}\s/;

export type Criterion = {
  /** Zeilennummer in der Datei, ab 0 — die Stelle, an der das Häkchen sitzt. */
  line: number;
  /** Erledigt? */
  done: boolean;
  /** Der Text dahinter, für Verlauf und Commit-Nachricht. */
  text: string;
};

/**
 * Die Akzeptanzkriterien einer .md, in der Reihenfolge der Datei.
 *
 * Gelesen wird NUR der Abschnitt unter der Kriterien-Überschrift. Kästchen
 * anderswo — etwa in einer Aufzählung unter "Out of Scope" — sind keine
 * Etappen; sie mitzuzählen hiesse, Arbeit abzuhaken, die niemand verlangt hat.
 */
export function criteriaOf(md: string | null | undefined): Criterion[] {
  if (!md) return [];
  const lines = md.split("\n");
  const start = lines.findIndex((l) => CRITERIA_HEADING.test(l.trim()));
  if (start < 0) return [];

  const out: Criterion[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i])) break; // nächster Abschnitt: vorbei
    const m = lines[i].match(CRITERION_LINE);
    if (!m) continue;
    out.push({
      line: i,
      done: m[2].toLowerCase() === "x",
      text: m[3].trim(),
    });
  }
  return out;
}

/** Das erste noch offene Kriterium, oder null wenn alle erledigt sind. */
export function nextOpen(criteria: Criterion[]): Criterion | null {
  return criteria.find((c) => !c.done) ?? null;
}

/** Sind alle Kriterien erledigt? Ohne Kriterien: nein — es gibt nichts zu zählen. */
export function allDone(criteria: Criterion[]): boolean {
  return criteria.length > 0 && criteria.every((c) => c.done);
}

/**
 * Dieselbe .md mit einem gesetzten Häkchen an `line`.
 *
 * Es wird nur das Kästchen ersetzt, der Rest der Zeile bleibt Zeichen für
 * Zeichen stehen — Einrückung, Text, alles. Ein Neu-Schreiben der Zeile würde
 * bei mehrzeiligen Kriterien den Rest verlieren.
 */
export function markDone(md: string, line: number): string {
  const lines = md.split("\n");
  const m = lines[line]?.match(CRITERION_LINE);
  if (!m) return md; // keine Kriteriumszeile: unverändert lassen
  lines[line] = lines[line].replace(/\[ \]/, "[x]");
  return lines.join("\n");
}

/** "3 von 8" — für Verlauf und Commit-Nachricht. */
export function progressLabel(criteria: Criterion[]): string {
  const done = criteria.filter((c) => c.done).length;
  return `${done} von ${criteria.length}`;
}

/**
 * Die Commit-Nachricht einer Etappe. Der Kriteriumstext wird gekürzt: Er kann
 * mehrere Zeilen lang sein, und eine Commit-Betreffzeile soll überblickbar
 * bleiben.
 */
export function stageCommitMessage(
  mdName: string,
  criteria: Criterion[],
  justDone: Criterion,
): string {
  const id = mdName.replace(/\.md$/i, "");
  const text = justDone.text.replace(/\s+/g, " ").trim();
  const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return `${id} (${progressLabel(criteria)}): ${short}`;
}
