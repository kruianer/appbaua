import { ABORT_EXIT_CODE, run, type RunResult } from "./workspace";
import { describeEvent, finalResultText, modelFromEvent } from "./claude-events";
import { SECURITY_OK_MESSAGE } from "./security-report";
import { RELEASE_INFO_MARKER } from "./release-info";

// Invokes Claude Code headless to work a task (req-006). Fully autonomous: the
// CLI runs non-interactively with permissions skipped so it never asks. Auth is
// the user's Anthropic subscription (via `claude login`, mounted into the
// container) — NOT an API key, so no usage costs. Coding uses Sonnet (5) to be
// easier on the operator's rate limits. A
// run is capped at CLAUDE_TIMEOUT_MS (120 min); on timeout or a missing CLI it returns a
// clean failure (never throws), so the worker logs "Fehler" and moves on.
//
// The CLI runs with structured streaming output and closed stdin (bug-001):
// print mode alone writes nothing to stdout until the very end, which made the
// live output of req-008 look frozen for minutes. The event stream is condensed
// into activity lines (claude-events), and the logged summary is taken from the
// stream's final "result" event, so the Fazit stays what it was (req-004).

/**
 * Wie lange ein einzelner Claude-Lauf laufen darf.
 *
 * Von 60 auf 120 Minuten erhoeht (11.09.2026): Mehrere Wegfara-Requirements
 * rissen die Stunde, und seit req-036 ist ein abgebrochener Lauf auch nicht
 * mehr verloren — seine fertigen Etappen sind committet und werden gesichert.
 * Eine grosszuegigere Grenze kostet also im schlimmsten Fall Zeit, aber keine
 * Arbeit mehr.
 */
export const CLAUDE_TIMEOUT_MS = 120 * 60_000;

/** Die Grenze in Minuten — fuer Meldungen, damit sie nie auseinanderlaufen. */
export const CLAUDE_TIMEOUT_MINUTES = CLAUDE_TIMEOUT_MS / 60_000;
export const CLAUDE_MODEL = "sonnet";

/**
 * What the Verlauf leads with when the Claude process died from a signal
 * instead of exiting on its own (bug-026). SIGKILL without warning is what
 * the kernel's OOM killer does — the 14.10. incident confirmed that directly
 * via journalctl — but a signal alone cannot prove the cause the way a log
 * line can, hence "mutmaßlich". This must stay distinguishable from both a
 * genuine failure and a network abort (req-038); see isOomKill in
 * network-abort.ts, which guards isNetworkAbort against this exact text.
 */
export const OOM_KILL_MESSAGE = "Claude-Lauf: mutmaßlich wegen Speichermangel beendet (SIGKILL)";

/**
 * What the Verlauf/Gespräch shows for a run the Stopp-Knopf ended (bug-030).
 * Distinct from a timeout or a genuine failure: the operator asked for this,
 * so it must never read like something went wrong.
 */
export const ABORTED_MESSAGE = "Claude-Lauf: abgebrochen";

/** Was this failed run the Stopp-Knopf ending it, rather than a real failure? */
export function isAborted(summary: string | null | undefined): boolean {
  return summary === ABORTED_MESSAGE;
}

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

/**
 * The prompt handed to Claude Code for a file-driven task.
 *
 * req-036 changed the one line that mattered most here: committing used to be
 * forbidden outright, so a run that was cut short — a dropped connection, the
 * 60-minute cap — left nothing behind and the next attempt started from zero.
 * On 07.09. that cost 16 minutes of finished work on a bug whose file was
 * perfectly fine.
 *
 * Now each acceptance criterion is its own stage: green suite, tick the box,
 * commit. A run that dies mid-way leaves the finished stages standing, and the
 * next one reads the ticks and picks up where it stopped.
 *
 * Pushing stays the worker's job. It knows the branch, carries the credential,
 * and is the only place that can retry a rejected push (bug-017).
 */
export function fileTaskPrompt(mdRelPath: string): string {
  return [
    `Arbeite die Aufgabe in der Datei ${mdRelPath} vollständig ab.`,
    `Halte dich an die CLAUDE.md und die Konventionen dieses Repos.`,
    ``,
    `Arbeite in Etappen — eine Etappe ist EIN Akzeptanzkriterium der Datei:`,
    `1. Setze das nächste noch offene Kriterium um, samt Tests.`,
    `2. Lass die volle Test-Suite laufen. Ist sie rot, arbeite weiter,`,
    `   bis sie grün ist — committe KEINEN roten Stand.`,
    `3. Hake das Kriterium in ${mdRelPath} ab ([ ] wird zu [x]).`,
    `4. Committe diesen Stand samt der geänderten .md.`,
    `Dann die nächste Etappe, bis alle Kriterien abgehakt sind.`,
    ``,
    `Hängen mehrere Kriterien so zusammen, dass sie sich nur gemeinsam`,
    `erfüllen lassen, hake sie zusammen in einer Etappe ab — der Schnitt`,
    `ist eine Empfehlung, keine Pflicht.`,
    ``,
    `Nennt die Datei keine Akzeptanzkriterien, arbeite sie wie bisher in`,
    `einem Zug ab und committe am Ende einmal.`,
    ``,
    `Sind alle Kriterien abgehakt, beende deine letzte Antwort mit dem Marker`,
    `"${RELEASE_INFO_MARKER}" auf eigener Zeile, danach EIN bis wenige Sätze`,
    `für den Betreiber der App — in SEINER Sprache, nicht technisch: was ist`,
    `für ihn jetzt anders. Betraf die Änderung eine Funktion ohne eigene`,
    `Oberfläche, ergänze einen Satz, woran er überhaupt merkt, dass es sie`,
    `gibt. Muss er selbst etwas tun, damit die Änderung wirkt (z.B. eine`,
    `Einstellung setzen), nenne genau das. Nenne nach dem Marker KEINE`,
    `Dateinamen und KEINE Testzahlen — die stehen bereits im Verlauf.`,
    `Lässt du ein Kriterium offen (z.B. weil die Zeit nicht reicht), lass den`,
    `Marker ganz weg.`,
    ``,
    `PUSHE NICHT — das übernimmt der Worker.`,
    `Arbeite vollständig autonom; frage nichts.`,
  ].join("\n");
}

/**
 * The prompt for the repair attempt a red test gate gets (req-019). It is the
 * only place that can rule out the cheap way to a green suite — deleting or
 * skipping the failing test — and the only place that can say what "green" has
 * to mean here: green in a fresh checkout, so a missing runtime dependency has
 * to land in the manifest instead of in this container.
 */
export function testFixPrompt(mdRelPath: string, failure: string): string {
  return [
    `Die vollständige Test-Suite dieses Repos ist ROT, nachdem du ${mdRelPath} umgesetzt hast.`,
    `Der Lauf meldet:`,
    `---`,
    failure,
    `---`,
    `Bringe die Test-Suite wieder auf grün, autonom und ohne Rückfragen.`,
    `Behebe die URSACHE — lösche, überspringe oder schwäche KEINEN Test ab, nur damit er durchläuft.`,
    `Fehlt eine Laufzeit-Abhängigkeit, deklariere sie in der package.json (samt Lockfile),`,
    `damit auch ein frischer Checkout mit Installation grün läuft — nur lokal installiert reicht nicht.`,
    `Halte dich an die CLAUDE.md und delivery/stack.md dieses Repos.`,
    `Committe den reparierten Stand, sobald die Suite grün ist (req-036).`,
    `PUSHE NICHT — das übernimmt der Worker.`,
  ].join("\n");
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
 * What the worker logs — and what Claude is asked to answer — when a
 * self-assign run found nothing sensible to propose (req-047).
 */
export const NO_SELF_ASSIGN_MESSAGE = "kein sinnvoller Selbstauftrag gefunden";

/**
 * The prompt for the Selbstauftrag task (req-047). Unlike the Ideen prompt
 * above, its result is not a loose idea but a finished Requirement, filed
 * straight into `readyDir` — the same place a human-written one lands, so it
 * must look like one: same frontmatter, same sections. The sources it is
 * told to read (vision, shipped requirements + code, past feedback, open
 * ideas, the repo's own conventions) and the vision's Non-Goals as a hard
 * boundary are both named explicitly here, because the requirement makes
 * both binding and nothing else in the pipeline enforces them.
 */
export function selfAssignPrompt(paths: {
  readyDir: string;
  doneRequirementsDir: string;
  ideaDir: string;
  feedbackDoneDir: string;
  visionFile: string;
}): string {
  return [
    `Schlage dir selbst GENAU EIN neues Requirement für dieses Repo vor —`,
    `eines, das als Nächstes sinnvoll fehlt, nicht, was dir irgendwie einfällt.`,
    `Schöpfe dabei aus ${paths.visionFile} (einschließlich ihrer Nicht-Ziele),`,
    `den bereits umgesetzten Requirements in ${paths.doneRequirementsDir}/ und`,
    `dem Code, früherem Feedback in ${paths.feedbackDoneDir}/, den offenen`,
    `Ideen in ${paths.ideaDir}/ sowie den Vorgaben dieses Repos (Stack, DevOps,`,
    `CLAUDE.md). Die Nicht-Ziele der Vision sind dabei eine Grenze, keine`,
    `Anregung — verstoße NICHT gegen sie.`,
    `Eine offene Idee ist nur eine Quelle, kein Auftrag: verschiebe, lösche`,
    `oder ändere KEINE Datei in ${paths.ideaDir}/, auch wenn du sie aufgreifst.`,
    `Lege das Requirement als neue .md-Datei direkt in ${paths.readyDir}/ ab,`,
    `in genau derselben Form wie ein von Hand geschriebenes: Frontmatter`,
    `(id, title, app, area, priority, created), danach die Abschnitte`,
    `"# Goal (Why)", "# Function (What)", "# Acceptance Criteria" (als`,
    `Given/when/then-Kästchen "- [ ] ...") und "# Out of Scope". Die id ist die`,
    `nächste freie req-NNN-Nummer über ALLE Unterordner von`,
    `delivery/requirements/ hinweg (draft, ready, in-progress, done); der`,
    `Dateiname ist req-NNN-<slug>.md.`,
    `Ändere sonst NICHTS in diesem Repo — kein Code, keine andere Datei; dies`,
    `ist ausschließlich das Anlegen dieser einen .md.`,
    `Findest du nichts Sinnvolles, lege KEINE Datei an und antworte genau`,
    `"${NO_SELF_ASSIGN_MESSAGE}".`,
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
 * What the worker logs — and what Claude is asked to answer — when a
 * feedback warranted no follow-up at all (req-043).
 */
export const NO_FEEDBACK_ACTION_MESSAGE = "keine Maßnahme nötig";

/**
 * The prompt for the Feedback task (req-043). A feedback is freeform text, not
 * a work order — it does not say what to do, so this prompt is the only place
 * that can hand Claude the decision the requirement reserves for it: turn it
 * into a Requirement, a Bug, a change to the vision, a note, or nothing.
 *
 * The one rule this prompt must never relax: a feedback changes no application
 * code. It may only add work for later — a new .md elsewhere in the repo's own
 * delivery/ folders, or a change to delivery/vision.md — which is why it names
 * those destinations explicitly instead of leaving "wohin" to Claude.
 */
export function feedbackPrompt(paths: {
  feedbackPath: string;
  bugsReadyDir: string;
  requirementsReadyDir: string;
  visionFile: string;
}): string {
  return [
    `Lies das Feedback in ${paths.feedbackPath} — es ist freier Text, der`,
    `einen Eindruck schildert, aber NICHT vorschreibt, was zu tun ist.`,
    `Entscheide selbst, was daraus wird: ein neues Requirement (neue .md in`,
    `${paths.requirementsReadyDir}/), ein neuer Bug (neue .md in`,
    `${paths.bugsReadyDir}/), eine Ergänzung von ${paths.visionFile}, eine`,
    `kurze Notiz — oder nichts, wenn das Feedback keine Konsequenz hat.`,
    `Ändere dabei KEINEN Code und keine bestehende Konfiguration der App —`,
    `ein Feedback erzeugt höchstens Arbeit für später, niemals direkt Code.`,
    `Lass ${paths.feedbackPath} selbst unverändert; der Worker verschiebt es.`,
    `Halte dich an die CLAUDE.md dieses Repos. Beende deine Antwort mit genau`,
    `einem Satz, was du entschieden hast (z. B. "Requirement`,
    `req-050-dunkelmodus.md angelegt" oder "${NO_FEEDBACK_ACTION_MESSAGE}").`,
    `Committe/pushe NICHT selbst — das übernimmt der Worker.`,
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
 *
 * `screenshots` are the pictures the worker already took of the running dev
 * environment (req-017). They are handed over as a closed list on purpose: the
 * placement is Claude's decision, but WHICH images exist is not — a page must
 * never point at a picture that was never taken.
 */
export function docPrompt(paths: {
  designDir: string;
  docSiteFile: string;
  docsDir: string;
  doneRequirementsDir: string;
  screenshots?: { page: string; rel: string }[];
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
    screenshotInstruction(paths.screenshots ?? []),
    `Schreibe alles, was zur Doku gehört (HTML, CSS, Assets), ausschließlich`,
    `nach ${paths.docsDir}/. Ändere sonst NICHTS im Repo — keinen Code, keine`,
    `Requirements, keine Konfiguration.`,
    `Committe/pushe NICHT selbst — das übernimmt der Worker.`,
    `Arbeite vollständig autonom; frage nichts.`,
  ].join(" ");
}

/**
 * What the Doku prompt says about this run's screenshots (req-017). Two cases,
 * and the second one matters as much as the first: a run whose screenshots
 * failed must produce a doc WITHOUT pictures rather than one with broken images,
 * because a page whose image is missing must still show its content.
 */
function screenshotInstruction(shots: { page: string; rel: string }[]): string {
  if (shots.length === 0) {
    return [
      `Für diesen Lauf stehen KEINE neuen Screenshots der App zur Verfügung.`,
      `Schreibe die Doku ohne neue Bilder und verweise auf KEINE Bild-Datei, die`,
      `es nicht gibt — eine Seite ohne Bild ist besser als eine mit kaputtem Bild.`,
      `Bereits eingebundene Bilder, deren Datei noch vorhanden ist, lässt du stehen.`,
    ].join(" ");
  }
  const list = shots.map((s) => `${s.rel} (zeigt ${s.page})`).join(", ");
  return [
    `Von der laufenden dev-Umgebung der App liegen bereits Screenshots im Repo:`,
    `${list}.`,
    `Binde jeden davon dort ein, wo die Doku über die gezeigte Seite spricht`,
    `(relativer Pfad von der jeweiligen Doku-Seite aus, mit beschreibendem`,
    `alt-Text). Verwende AUSSCHLIESSLICH diese Bilder, erzeuge selbst keine`,
    `weiteren Bild-Dateien und verweise auf keine Bild-Datei, die es nicht gibt —`,
    `eine Seite ohne Bild ist besser als eine mit kaputtem Bild.`,
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
     * The model requested via --model (req-028): the repo's own choice, falling
     * back to the project default when none is given. What actually ran is a
     * separate question — see onModel below.
     */
    model?: string;
    /**
     * Receives the last ~50 activity lines while the run is still going
     * (req-008; content per bug-001), at most about once per second. Errors from
     * it are swallowed — live output must never break the run.
     */
    onOutput?: (tail: string) => void;
    /**
     * Fires once with the model the run's own "init" event names (req-027) —
     * the model actually used, read from the event stream rather than assumed
     * from the --model flag handed in. Never fires again after the first call.
     */
    onModel?: (model: string) => void;
    /** Clock for the throttle; injectable for tests. */
    now?: () => number;
    /**
     * Continue a previous conversation by its Claude session id (req-040):
     * the Chat feature's turns are separate CLI invocations that must still
     * share one context, which `--resume` is what the CLI itself offers for
     * that. Mutually exclusive with `sessionId` — a turn either continues an
     * existing session or starts a new one, never both.
     */
    resume?: string;
    /**
     * Start a NEW conversation under a caller-chosen session id (req-040)
     * instead of letting the CLI generate one — so the id is known up front
     * and can be persisted for the next turn's `resume`.
     */
    sessionId?: string;
    /**
     * Ends the run from outside (bug-030: der Stopp-Knopf im Chat). Forwarded
     * straight to `run()`, which already knows how to take the whole process
     * tree down on a timeout — an abort gets the identical treatment.
     */
    signal?: AbortSignal;
  },
): Promise<ClaudeOutcome> {
  const runImpl = deps?.runImpl ?? run;
  const timeoutMs = deps?.timeoutMs ?? CLAUDE_TIMEOUT_MS;
  const model = deps?.model ?? CLAUDE_MODEL;
  const onOutput = deps?.onOutput;
  const onModel = deps?.onModel;
  const activityData = onOutput
    ? createActivityStream(onOutput, { now: deps?.now })
    : undefined;
  // A second, independent look at the same raw lines for the model (req-027):
  // this must never depend on onOutput being set, and must never throw into the
  // process's stdout handler.
  let modelSeen = false;
  let rest = "";
  const onData =
    activityData || onModel
      ? (chunk: string) => {
          activityData?.(chunk);
          if (onModel && !modelSeen) {
            const parts = (rest + chunk).split("\n");
            rest = parts.pop() ?? "";
            for (const line of parts) {
              const model = modelFromEvent(line);
              if (model) {
                modelSeen = true;
                onModel(model);
                break;
              }
            }
          }
        }
      : undefined;

  let res: RunResult;
  try {
    res = await runImpl(
      "claude",
      [
        "-p",
        prompt,
        "--model",
        model,
        "--dangerously-skip-permissions",
        // One JSON event per line while the session runs, instead of a silent
        // stdout (bug-001). The CLI requires --verbose for stream-json in print
        // mode.
        "--output-format",
        "stream-json",
        "--verbose",
        ...(deps?.resume ? ["--resume", deps.resume] : []),
        ...(deps?.sessionId ? ["--session-id", deps.sessionId] : []),
      ],
      // Closed stdin: nothing is piped in, and an open pipe makes the CLI wait
      // for input and warn about it (bug-001).
      { cwd: dir, timeoutMs, onData, stdin: "ignore", signal: deps?.signal },
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
  // Checked before the SIGKILL branch below: a timeout is already known with
  // certainty (code 124 only ever comes from run()'s OWN timeout path), so it
  // must win over a signal field a test stub might also set for that code.
  if (res.code === 124) {
    // On timeout, keep the last activity so a run that hung on a rate limit can
    // be told from one that was genuinely busy (req-026). finalResultText finds
    // no final "result" event on a killed run, so fall back to the raw tail.
    const lastActivity = (
      finalResultText(res.stdout) ||
      res.stdout ||
      res.stderr
    )
      .trim()
      .slice(-300);
    const note = lastActivity ? ` — zuletzt: ${lastActivity}` : "";
    return {
      ok: false,
      summary: `Claude-Lauf: Timeout (${CLAUDE_TIMEOUT_MINUTES} min)${note}`,
      report: "",
    };
  }
  // A process that died from an external SIGKILL (bug-026) — most likely the
  // kernel's OOM killer, since run()'s own timeout kill is already handled
  // above via code 124 and never reaches here with the signal set. Checked
  // before the generic !res.ok branch below, which would otherwise log an
  // empty or misleading tail: a process killed this abruptly gets no chance
  // to write a final error message.
  if (res.signal === "SIGKILL") {
    return { ok: false, summary: OOM_KILL_MESSAGE, report: "" };
  }
  // bug-030: the Stopp-Knopf's own exit code — checked before the generic
  // !res.ok branch for the same reason as the two above, and distinct from
  // both: this is neither a timeout nor a crash, so it must never read as
  // "Claude-Lauf fehlgeschlagen: …".
  if (res.code === ABORT_EXIT_CODE) {
    return { ok: false, summary: ABORTED_MESSAGE, report: "" };
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
