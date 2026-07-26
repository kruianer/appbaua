import { run, type RunResult } from "./workspace";
import { describeEvent, finalResultText } from "./claude-events";
import { SECURITY_OK_MESSAGE } from "./security-report";

// Invokes Claude Code headless to work a task (req-006). Fully autonomous: the
// CLI runs non-interactively with permissions skipped so it never asks. Auth is
// the user's Anthropic subscription (via `claude login`, mounted into the
// container) — NOT an API key, so no usage costs. Coding always uses Opus. A
// run is capped at CLAUDE_TIMEOUT_MS; on timeout or a missing CLI it returns a
// clean failure (never throws), so the worker logs "Fehler" and moves on.
//
// The CLI runs with structured streaming output and closed stdin (bug-001):
// print mode alone writes nothing to stdout until the very end, which made the
// live output of req-008 look frozen for minutes. The event stream is condensed
// into activity lines (claude-events), and the logged summary is taken from the
// stream's final "result" event, so the Fazit stays what it was (req-004).

export const CLAUDE_TIMEOUT_MS = 60 * 60_000; // 60 minutes
export const CLAUDE_MODEL = "opus";

/** How much of the running output is published live, and how often (req-008). */
export const LIVE_TAIL_LINES = 50;
export const LIVE_THROTTLE_MS = 1000;

export type ClaudeOutcome = {
  ok: boolean;
  /** Short message for the run log (req-004): the tail of the final answer. */
  summary: string;
  /**
   * Claude's complete, untruncated final answer (req-010). For a recurring
   * analysis task this IS the report, which the worker files in the target
   * repo; the run log keeps `summary` only. Empty for a failed run — nothing
   * gets filed then.
   */
  report: string;
};

/** The last `n` lines of `text` (fewer if there are not that many). */
export function lastLines(text: string, n: number = LIVE_TAIL_LINES): string {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

/**
 * Accumulates process output and hands the current tail to `emit` at most once
 * per `intervalMs` (req-008). The first chunk goes out right away so the
 * Aktivität tab shows something as soon as Claude says anything; everything
 * after that is throttled, because writing the status on every chunk would
 * hammer the database.
 */
export function createLiveTail(
  emit: (tail: string) => void,
  opts: { intervalMs?: number; lines?: number; now?: () => number } = {},
): (chunk: string) => void {
  const intervalMs = opts.intervalMs ?? LIVE_THROTTLE_MS;
  const lines = opts.lines ?? LIVE_TAIL_LINES;
  const now = opts.now ?? (() => Date.now());
  let buffer = "";
  let lastEmit: number | null = null;
  return (chunk: string) => {
    // Trim on every chunk: only the tail is ever published, so the buffer of a
    // one-hour run stays bounded.
    buffer = lastLines(buffer + chunk, lines);
    const t = now();
    if (lastEmit !== null && t - lastEmit < intervalMs) return;
    lastEmit = t;
    emit(buffer);
  };
}

/**
 * Turns the chunk stream of a `--output-format stream-json` run into a
 * throttled tail of human-readable activity lines (bug-001). Chunks do not
 * respect line boundaries, so an incomplete trailing line is held back until
 * the rest of it arrives. Events that say nothing worth showing emit nothing at
 * all — the tail then simply keeps its previous content.
 */
export function createActivityStream(
  emit: (tail: string) => void,
  opts: { intervalMs?: number; lines?: number; now?: () => number } = {},
): (chunk: string) => void {
  const pushTail = createLiveTail(emit, opts);
  let rest = "";
  return (chunk: string) => {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop() ?? "";
    const activity = parts.flatMap(describeEvent);
    if (activity.length > 0) pushTail(`${activity.join("\n")}\n`);
  };
}

/** The prompt handed to Claude Code for a file-driven task. */
export function fileTaskPrompt(mdRelPath: string): string {
  return [
    `Arbeite die Aufgabe in der Datei ${mdRelPath} vollständig ab.`,
    `Halte dich an die CLAUDE.md und die Konventionen dieses Repos.`,
    `Setze die Anforderung/den Bugfix um, schreibe/aktualisiere Tests,`,
    `und stelle sicher, dass das Quality Gate grün ist.`,
    `Committe NICHT selbst und pushe NICHT — das übernimmt der Worker.`,
    `Arbeite vollständig autonom; frage nichts.`,
  ].join(" ");
}

/**
 * The prompt for a recurring task (code-review, doku, ...). Its final answer is
 * filed as a report in the repo (req-010), so the prompt asks for the whole
 * report there instead of a summary.
 */
export function recurringPrompt(kindLabel: string): string {
  return [
    `Führe eine ${kindLabel} für dieses Repo durch, autonom und ohne Rückfragen.`,
    `Halte dich an die CLAUDE.md und die Konventionen dieses Repos.`,
    `Gib deinen vollständigen Bericht als finale Antwort in Markdown aus —`,
    `er wird als Datei im Repo abgelegt.`,
    `Committe/pushe NICHT selbst.`,
  ].join(" ");
}

/**
 * What the worker logs — and what Claude is asked to answer — when a run found
 * nothing worth proposing (req-011).
 */
export const NO_IDEA_MESSAGE = "keine neue Idee gefunden";

/**
 * The prompt for the Ideen task (req-011). Unlike the other recurring types it
 * produces no report: its result is exactly one new idea file, written by Claude
 * into `ideaDir` of the working copy, which the worker then commits and pushes.
 * Everything the idea must not be — a duplicate of an open idea, a re-run of
 * something already implemented, off the repo's steer — is stated here, because
 * this prompt is the only place that can rule it out.
 */
export function ideaPrompt(paths: {
  ideaDir: string;
  doneDir: string;
  directionFile: string;
}): string {
  return [
    `Schlage GENAU EINE neue Idee für dieses Repo vor.`,
    `Lies dazu zuerst die bereits vorhandenen Ideen in ${paths.ideaDir}/ (offen)`,
    `und ${paths.doneDir}/ (bereits umgesetzt) sowie — falls vorhanden — die`,
    `Richtungs-Vorgabe ${paths.directionFile} und die CLAUDE.md dieses Repos.`,
    `Die neue Idee darf inhaltlich weder eine Dublette einer vorhandenen noch`,
    `einer bereits umgesetzten Idee sein und muss zur Richtungs-Vorgabe passen;`,
    `gibt es keine Richtungs-Vorgabe, schlage frei eine sinnvolle Idee zum Repo vor.`,
    `Lege die Idee als neue .md-Datei direkt in ${paths.ideaDir}/ ab`,
    `(Dateiname in kebab-case, NICHT in ${paths.doneDir}/), mit Frontmatter`,
    `(titel, datum) und den Abschnitten "## Problem/Nutzen" und "## Skizze".`,
    `Findest du keine solche Idee, lege KEINE Datei an und antworte genau`,
    `"${NO_IDEA_MESSAGE}".`,
    `Ändere sonst nichts im Repo — kein Code, keine anderen Dateien.`,
    `Committe/pushe NICHT selbst. Arbeite vollständig autonom; frage nichts.`,
  ].join(" ");
}

/**
 * The prompt for the Security task (req-014). Like a recurring task it answers
 * with a report — but only when it actually found something, because a run
 * without findings files no file at all. The four areas, the severity, the
 * recommendation and the live-vs-derived marking are pinned here, because this
 * prompt is the only place that can ask for them.
 */
export function securityPrompt(paths: { policyFile: string }): string {
  return [
    `Führe einen Sicherheits-Check für dieses Repo durch, autonom und ohne Rückfragen.`,
    `Lies zuerst — falls vorhanden — die Sicherheits-Vorgaben ${paths.policyFile}`,
    `(Erreichbarkeit, HTTPS-Pflicht, Zugriffskreis, Backup-Erwartung, Datenschutz)`,
    `sowie die CLAUDE.md dieses Repos. Sie sind das SOLL, gegen das du das IST prüfst.`,
    `Fehlt ${paths.policyFile}, prüfe nach allgemeinen Sicherheits-Best-Practices und`,
    `vermerke im Bericht ausdrücklich, dass keine repo-spezifische Vorgabe vorlag.`,
    `Prüfe diese vier Bereiche, so tief dein Zugriff reicht`,
    `(Requirements/Code/Config immer; Infrastruktur/SSH nur, wo Zugang hinterlegt ist):`,
    `1. Zugriff & Erreichbarkeit (passt die tatsächliche Erreichbarkeit zur Vorgabe:`,
    `nur WLAN vs. von außen, HTTPS erzwungen, Auth/Login vorhanden, wer darf zugreifen),`,
    `2. Datenschutz & Datenhaltung (Secrets/Passwörter/Tokens im Repo, Umgang mit`,
    `personenbezogenen/sensiblen Daten),`,
    `3. Backup & Wiederherstellung (Abgleich mit der Backup-Erwartung),`,
    `4. Abhängigkeiten & bekannte Lücken (veraltete/verwundbare Dependencies,`,
    `unsichere Default-Konfiguration).`,
    `Ändere NICHTS im Repo — kein Code, keine Config, keine Dateien; dies ist eine`,
    `reine Prüfung. Committe/pushe NICHT selbst.`,
    `Hast du mindestens ein Finding, gib deinen vollständigen Bericht als finale`,
    `Antwort in Markdown aus — er wird als Datei im Repo abgelegt. Der Bericht`,
    `beginnt mit einer Kurz-Zusammenfassung; danach folgt jedes Finding mit`,
    `Schweregrad (hoch/mittel/niedrig), einer konkreten Empfehlung und der Angabe,`,
    `ob es live verifiziert oder nur aus Code/Config erschlossen wurde.`,
    `Findest du keine Auffälligkeit, gib KEINEN Bericht aus und antworte genau`,
    `"${SECURITY_OK_MESSAGE}".`,
    `Arbeite vollständig autonom; frage nichts.`,
  ].join(" ");
}

/**
 * The prompt for the Doku task (req-016). Its result is neither code nor a
 * report but a multi-page user documentation under `docsDir`, so this prompt is
 * the only place that can pin the three things req-016 asks for and nothing else
 * can enforce: follow the design template as far as possible, derive the content
 * from the shipped requirements and the code, and UPDATE the existing pages
 * instead of rebuilding the site — a doc that looks different after every run is
 * exactly what the requirement rules out.
 */
export function docPrompt(paths: {
  designDir: string;
  docSiteFile: string;
  docsDir: string;
  doneRequirementsDir: string;
}): string {
  return [
    `Pflege die Benutzer-Dokumentation dieses Repos als mehrseitige Website,`,
    `autonom und ohne Rückfragen.`,
    `Lies zuerst die Design-Vorgabe in ${paths.designDir}/ (HTML/CSS-Vorlage plus`,
    `Handover-Markdown) sowie ${paths.docSiteFile} und die CLAUDE.md dieses Repos.`,
    `Halte dich SO WEIT WIE MÖGLICH an die Design-Vorlage — Kopf, Farben,`,
    `Typografie und Navigation folgen ihr erkennbar. Sie ist Orientierung, kein`,
    `starres Template: wo sie nichts vorgibt, entscheide im Sinne der Vorlage.`,
    `Den Inhalt leitest du aus den umgesetzten Requirements in`,
    `${paths.doneRequirementsDir}/ und aus dem Code ab, und beschreibst ihn aus`,
    `Sicht der Nutzer der App (was kann ich damit tun, wie geht das) — nicht`,
    `technisch und nicht als Requirement-Liste.`,
    `Lies VOR jeder Änderung die vorhandenen Seiten in ${paths.docsDir}/ und`,
    `aktualisiere sie INKREMENTELL: ergänze neue Inhalte, passe Seiten an, deren`,
    `Thema sich geändert hat, und lass jede Seite, deren Thema unverändert ist,`,
    `inhaltlich stehen. Baue die Doku NICHT bei jedem Lauf neu auf und ändere`,
    `weder Struktur noch Aussehen ohne Anlass — die Seite soll nicht bei jedem`,
    `Lauf anders aussehen. Gibt es noch keine Doku, lege sie neu an.`,
    `Schreibe alles, was zur Doku gehört (HTML, CSS, Assets), ausschließlich`,
    `nach ${paths.docsDir}/. Ändere sonst NICHTS im Repo — keinen Code, keine`,
    `Requirements, keine Konfiguration.`,
    `Committe/pushe NICHT selbst — das übernimmt der Worker.`,
    `Arbeite vollständig autonom; frage nichts.`,
  ].join(" ");
}

/**
 * Run Claude Code in `dir` with `prompt`. Injectable runner for tests.
 */
export async function runClaude(
  dir: string,
  prompt: string,
  deps?: {
    runImpl?: typeof run;
    timeoutMs?: number;
    /**
     * Receives the last ~50 activity lines while the run is still going
     * (req-008; content per bug-001), at most about once per second. Errors from
     * it are swallowed — live output must never break the run.
     */
    onOutput?: (tail: string) => void;
    /** Clock for the throttle; injectable for tests. */
    now?: () => number;
  },
): Promise<ClaudeOutcome> {
  const runImpl = deps?.runImpl ?? run;
  const timeoutMs = deps?.timeoutMs ?? CLAUDE_TIMEOUT_MS;
  const onOutput = deps?.onOutput;
  const onData = onOutput
    ? createActivityStream(onOutput, { now: deps?.now })
    : undefined;

  let res: RunResult;
  try {
    res = await runImpl(
      "claude",
      [
        "-p",
        prompt,
        "--model",
        CLAUDE_MODEL,
        "--dangerously-skip-permissions",
        // One JSON event per line while the session runs, instead of a silent
        // stdout (bug-001). The CLI requires --verbose for stream-json in print
        // mode.
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      // Closed stdin: nothing is piped in, and an open pipe makes the CLI wait
      // for input and warn about it (bug-001).
      { cwd: dir, timeoutMs, onData, stdin: "ignore" },
    );
  } catch (err) {
    return {
      ok: false,
      summary: `Claude-Aufruf fehlgeschlagen: ${String(err)}`,
      report: "",
    };
  }

  if (res.code === 127) {
    return { ok: false, summary: "Claude-Code-CLI nicht verfügbar", report: "" };
  }
  if (res.code === 124) {
    return { ok: false, summary: "Claude-Lauf: Timeout (60 min)", report: "" };
  }
  if (!res.ok) {
    const tail = (res.stderr.trim() || finalResultText(res.stdout)).slice(-300);
    return { ok: false, summary: `Claude-Lauf fehlgeschlagen: ${tail}`, report: "" };
  }
  // The full answer becomes the report file (req-010); the log keeps its tail.
  const full = finalResultText(res.stdout);
  const tail = full.slice(-300);
  return { ok: true, summary: tail || "Claude-Lauf erfolgreich", report: full };
}
