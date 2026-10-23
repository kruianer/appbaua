import { randomUUID } from "node:crypto";
import type { Repo } from "./repos";
import {
  type ChatSessionStore,
  getChatSessionStore,
} from "./chat-session-store";
import { getChatUiStateStore } from "./chat-store";
import { prepareChatRepo } from "./chat-workspace";
import { type ClaudeOutcome, isAborted, runClaude } from "./claude-runner";
import { touchActiveSession, pruneIdleSessions } from "./chat-session-lru";
import { isRateLimit } from "./rate-limit";
import { isSessionNotFound } from "./chat-session-lost";
import { isAuthExpired, authExpiredChatMessage } from "./auth-expired";
import { redact } from "./redact";
import { createStepTracker } from "./chat-steps";

// Orchestrates one chat turn (req-040): append the user's message, make sure
// the repo has a working copy of its OWN (chat-workspace.ts, AC15), run
// Claude continuing the repo's session (or starting one), and append the
// result. Claude always runs with the strongest model here, independent of
// the repo's own worker model setting (constraint).
export const CHAT_MODEL = "opus";

export type PreparedChatRepo = { dir: string; branch: string };

export type SendMessageDeps = {
  store?: ChatSessionStore;
  prepareRepo?: (repo: Repo, token: string) => Promise<PreparedChatRepo>;
  runClaude?: (
    dir: string,
    prompt: string,
    opts: Record<string, unknown>,
  ) => Promise<ClaudeOutcome>;
  now?: () => Date;
  newSessionId?: () => string;
  token?: string;
  /** Which repo is currently open in the Chat tab (req-040 AC8/AC9). */
  getActiveRepoId?: () => Promise<string | null>;
  /** Welche Umgebung gerade läuft (bug-031 AUTH_EXPIRED_CHAT_MESSAGE) — nur zum Testen. */
  env?: Record<string, string | undefined>;
};

/** What a chat turn says when no push credential is configured at all. */
export const NO_TOKEN_MESSAGE = "Kein GitHub-Token für den Chat konfiguriert.";

/**
 * What a chat turn says when the Abo-Limit (req-040 constraint) is hit. Chat
 * and der nächtliche Worker teilen dasselbe Abo, also ist das hier nie nur
 * das Problem dieses Gesprächs — die Meldung sagt das ausdrücklich (AC13).
 */
export const RATE_LIMIT_CHAT_MESSAGE =
  "Das Abo-Limit ist erreicht. Das betrifft auch den nächtlichen Worker — " +
  "er pausiert ebenfalls, bis das Limit zurückgesetzt ist.";

/**
 * What the chat says when Claude no longer knows the --resume'd session
 * (bug-029) and the turn starts a fresh one instead. Shown so the broken
 * thread is visible, even though it no longer blocks the conversation.
 */
export const SESSION_LOST_MESSAGE =
  "Die vorherige Sitzung ist nicht mehr bekannt — das Gespräch beginnt neu.";

/**
 * What the Gespräch shows for a turn the Stopp-Knopf ended (bug-030). Kept
 * short and neutral — the operator asked for this, it is not an error.
 */
export const ABORTED_CHAT_MESSAGE = "Abgebrochen.";

/**
 * Der Controller des gerade laufenden Claude-Aufrufs je Repo (bug-030) — der
 * Griff, den der Stopp-Knopf braucht, um genau DIESEN Lauf zu beenden. Nur
 * waehrend runClaudeImpl tatsaechlich laeuft gesetzt; das Vorbereiten der
 * Arbeitskopie (prepareRepo) ist davon bewusst nicht erfasst, weil dort kein
 * Prozess haengt, der bis zu zwei Stunden dauern koennte.
 */
const runningControllers = new Map<string, AbortController>();

/**
 * Beendet den gerade laufenden Claude-Aufruf fuer `repoId`, falls einer
 * laeuft (bug-030). Gibt zurueck, ob es einen gab — ein Repo ohne laufenden
 * Lauf hat hier nichts zu tun, aber das ist kein Fehler.
 */
export function cancelChatTurn(repoId: string): boolean {
  const controller = runningControllers.get(repoId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * Live Schritte des gerade laufenden (oder soeben beendeten) Zugs je Repo
 * (req-048), seit req-051 als Zeitstrahl mit Status und Ergebnis je Schritt
 * (lib/chat-steps.ts), gelesen aus dem Roh-Ereignisstrom (onEvent). Wird erst
 * ersetzt, wenn fuer dasselbe Repo ein NEUER Zug beginnt — ein beendeter oder
 * gestoppter Zug behält also seinen letzten Stand (bug-030).
 *
 * Der Stand wird am Ende des Zugs an der Antwort gespeichert (siehe `steps`
 * unten), damit auch eine frühere Frage ihre Schritte samt Ergebnissen beim
 * Zurückrollen noch zeigt. Eine Kappung wie beim Worker gibt es nicht.
 */
const currentSteps = new Map<string, ReturnType<typeof createStepTracker>>();

export function getChatSteps(repoId: string): string | null {
  return currentSteps.get(repoId)?.serialize() ?? null;
}

/** Test-only reset: production never needs to clear this between runs. */
export function resetChatStepsForTests(): void {
  currentSteps.clear();
}

export async function sendChatMessage(
  repo: Repo,
  content: string,
  deps: SendMessageDeps = {},
): Promise<void> {
  const store = deps.store ?? getChatSessionStore();
  const prepareRepo = deps.prepareRepo ?? ((r, token) => prepareChatRepo(r, token));
  const runClaudeImpl = deps.runClaude ?? runClaude;
  const now = deps.now ?? (() => new Date());
  const newSessionId = deps.newSessionId ?? (() => randomUUID());
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  const getActiveRepoId =
    deps.getActiveRepoId ?? (() => getChatUiStateStore().getActiveRepoId());
  const env = deps.env ?? process.env;

  // req-040 AC10/AC11/AC12: höchstens fünf Sitzungen gleichzeitig; eine
  // sechste verdrängt die am längsten unbenutzte, und eine Sitzung ohne
  // Eingabe acht Stunden lang endet von selbst (erst geprüft, dann erst
  // angetippt — sonst würde eine abgelaufene Sitzung fälschlich noch Platz
  // wegnehmen). Beides betrifft nur dieses In-Memory-Set — das Gespräch
  // liegt im Store und bleibt davon unberührt, bleibt also auch nach einer
  // Verdrängung oder einem Leerlaufende vollständig lesbar und beschreibbar.
  const nowMs = now().getTime();
  activeSessionIds = pruneIdleSessions(
    activeSessionIds,
    lastActiveAtMs,
    nowMs,
    undefined,
    new Set(runningTurns.keys()),
  );
  const touched = touchActiveSession(activeSessionIds, repo.id);
  activeSessionIds = touched.active;
  lastActiveAtMs[repo.id] = nowMs;

  await store.appendMessage({
    repoId: repo.id,
    role: "user",
    content,
    createdAt: now().toISOString(),
  });

  if (!token) {
    await store.appendMessage({
      repoId: repo.id,
      role: "system",
      content: NO_TOKEN_MESSAGE,
      createdAt: now().toISOString(),
    });
    return;
  }

  let dir: string;
  try {
    const prepared = await prepareRepo(repo, token);
    dir = prepared.dir;
  } catch (err) {
    await store.appendMessage({
      repoId: repo.id,
      role: "system",
      content: `Repo konnte nicht vorbereitet werden: ${String(err)}`,
      createdAt: now().toISOString(),
    });
    return;
  }

  const session = await store.getSession(repo.id);
  const sessionId = session?.claudeSessionId ?? newSessionId();

  // bug-030: der Griff fuer den Stopp-Knopf — nur waehrend des eigentlichen
  // Claude-Aufrufs gesetzt, siehe runningControllers oben.
  const controller = new AbortController();
  runningControllers.set(repo.id, controller);

  // req-048: dieser Zug beginnt frisch — ein etwaiger Rest des vorigen Zugs
  // (fertig oder gestoppt) räumt jetzt erst Platz, nicht wenn DIESER Zug endet.
  currentSteps.delete(repo.id);
  // req-051: Schritte mit Status und Ergebnis aus dem Roh-Ereignisstrom; sie
  // werden je Feld geschwärzt (redact).
  const tracker = createStepTracker(redact);
  currentSteps.set(repo.id, tracker);
  const onEvent = (line: string) => tracker.push(line);

  let outcome: ClaudeOutcome;
  let finalSessionId = sessionId;
  let sessionLost = false;
  try {
    outcome = await runClaudeImpl(dir, content, {
      model: CHAT_MODEL,
      signal: controller.signal,
      onEvent,
      ...(session ? { resume: sessionId } : { sessionId }),
    });

    // bug-029: Claude no longer knows the session it was asked to --resume (most
    // commonly because a container restart emptied CHAT_WORK_ROOT). Rather than
    // leaving the repo permanently stuck on that dead id, drop it and retry once
    // with a brand-new session — the SAME message gets answered either way.
    if (session && !outcome.ok && isSessionNotFound(outcome.summary)) {
      sessionLost = true;
      finalSessionId = newSessionId();
      outcome = await runClaudeImpl(dir, content, {
        model: CHAT_MODEL,
        signal: controller.signal,
        onEvent,
        sessionId: finalSessionId,
      });
    }
  } finally {
    if (runningControllers.get(repo.id) === controller) {
      runningControllers.delete(repo.id);
    }
  }

  // bug-038: das Ende der Arbeit zählt als Aktivität — die Stunde Leerlauf
  // beginnt erst jetzt, nicht schon beim Absenden.
  lastActiveAtMs[repo.id] = now().getTime();

  await store.putSession({
    repoId: repo.id,
    claudeSessionId: finalSessionId,
    lastActiveAt: now().toISOString(),
    unread: session?.unread ?? false,
  });

  if (sessionLost) {
    await store.appendMessage({
      repoId: repo.id,
      role: "system",
      content: SESSION_LOST_MESSAGE,
      createdAt: now().toISOString(),
    });
  }

  await store.appendMessage({
    repoId: repo.id,
    // req-049 AC9: die Schritte dieses Zugs bleiben dauerhaft an SEINER
    // Antwort hängen — so zeigt auch eine ältere Frage ihre eigenen Schritte
    // beim Zurückrollen, statt nur den zuletzt gelaufenen Zug des Repos.
    steps: getChatSteps(repo.id) ?? undefined,
    ...(outcome.ok
      ? { role: "assistant" as const, content: outcome.report || outcome.summary }
      : isAborted(outcome.summary)
        ? { role: "system" as const, content: ABORTED_CHAT_MESSAGE }
        // bug-031: vor Rate-Limit geprüft, da sich die beiden Muster nicht
        // überschneiden (siehe execute-step.ts) — ein abgelaufenes Login
        // bekommt den Befehl zum Neu-Anmelden statt des rohen OAuth-Texts.
        : isAuthExpired(outcome.summary)
          ? { role: "system" as const, content: authExpiredChatMessage(env) }
          : isRateLimit(outcome.summary)
            ? { role: "system" as const, content: RATE_LIMIT_CHAT_MESSAGE }
            : { role: "system" as const, content: `Fehler: ${outcome.summary}` }),
    createdAt: now().toISOString(),
  });

  // Der Hinweispunkt auf dem Chat-Knopf (AC8): eine fertige Antwort markiert
  // ihr Repo als ungelesen, es sei denn, genau dieses Repo ist gerade offen.
  if ((await getActiveRepoId()) !== repo.id) {
    await store.setUnread(repo.id, true);
  }
}

// req-040 AC5/AC6: a repo's turn must keep running when the operator switches
// to another repo, and the other repo must be writable right away — neither
// may wait on the other. sendChatMessage above is a single awaitable turn;
// startChatTurn below is what the API route calls instead of awaiting it
// directly, so the HTTP request returns immediately while the turn (which can
// run for up to CLAUDE_TIMEOUT_MS) keeps going server-side. `isChatTurnRunning`
// lets a caller (tests, diagnostics) ask whether a given repo's turn is still
// in flight.
const runningTurns = new Map<string, Promise<void>>();

export function isChatTurnRunning(repoId: string): boolean {
  return runningTurns.has(repoId);
}

// req-040 AC10/AC11: the repos whose session currently counts as active,
// oldest-use first. Bookkeeping only (see touchActiveSession above) — never
// gates a turn, never touches the persisted conversation.
let activeSessionIds: string[] = [];
/** When each repo's session was last touched (epoch ms) — AC12's 8h clock. */
let lastActiveAtMs: Record<string, number> = {};

/** Repos whose session counts as active right now, oldest-use first. */
export function activeSessionRepoIds(): string[] {
  return [...activeSessionIds];
}

/** Test-only reset: production never needs to clear this between runs. */
export function resetActiveSessionsForTests(): void {
  activeSessionIds = [];
  lastActiveAtMs = {};
}

export function startChatTurn(
  repo: Repo,
  content: string,
  deps: SendMessageDeps = {},
): Promise<void> {
  const turn = sendChatMessage(repo, content, deps).catch(() => {
    // sendChatMessage already turns every failure it can anticipate into a
    // chat message of its own; this is only the backstop against an
    // unexpected throw taking the whole turn down as an unhandled rejection.
  });
  runningTurns.set(repo.id, turn);
  void turn.finally(() => {
    if (runningTurns.get(repo.id) === turn) runningTurns.delete(repo.id);
  });
  return turn;
}
