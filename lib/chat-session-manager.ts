import { randomUUID } from "node:crypto";
import type { Repo } from "./repos";
import {
  type ChatSessionStore,
  getChatSessionStore,
} from "./chat-session-store";
import { getChatUiStateStore } from "./chat-store";
import { prepareChatRepo } from "./chat-workspace";
import { type ClaudeOutcome, runClaude } from "./claude-runner";
import { touchActiveSession, pruneIdleSessions } from "./chat-session-lru";
import { isRateLimit } from "./rate-limit";

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

  // req-040 AC10/AC11/AC12: höchstens fünf Sitzungen gleichzeitig; eine
  // sechste verdrängt die am längsten unbenutzte, und eine Sitzung ohne
  // Eingabe acht Stunden lang endet von selbst (erst geprüft, dann erst
  // angetippt — sonst würde eine abgelaufene Sitzung fälschlich noch Platz
  // wegnehmen). Beides betrifft nur dieses In-Memory-Set — das Gespräch
  // liegt im Store und bleibt davon unberührt, bleibt also auch nach einer
  // Verdrängung oder einem Leerlaufende vollständig lesbar und beschreibbar.
  const nowMs = now().getTime();
  activeSessionIds = pruneIdleSessions(activeSessionIds, lastActiveAtMs, nowMs);
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

  const outcome = await runClaudeImpl(dir, content, {
    model: CHAT_MODEL,
    ...(session ? { resume: sessionId } : { sessionId }),
  });

  await store.putSession({
    repoId: repo.id,
    claudeSessionId: sessionId,
    lastActiveAt: now().toISOString(),
    unread: session?.unread ?? false,
  });

  await store.appendMessage({
    repoId: repo.id,
    ...(outcome.ok
      ? { role: "assistant" as const, content: outcome.report || outcome.summary }
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
