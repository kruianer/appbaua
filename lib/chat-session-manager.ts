import { randomUUID } from "node:crypto";
import type { Repo } from "./repos";
import {
  type ChatSessionStore,
  getChatSessionStore,
} from "./chat-session-store";
import { prepareChatRepo } from "./chat-workspace";
import { type ClaudeOutcome, runClaude } from "./claude-runner";

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
};

/** What a chat turn says when no push credential is configured at all. */
export const NO_TOKEN_MESSAGE = "Kein GitHub-Token für den Chat konfiguriert.";

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
  });

  if (!outcome.ok) {
    await store.appendMessage({
      repoId: repo.id,
      role: "system",
      content: `Fehler: ${outcome.summary}`,
      createdAt: now().toISOString(),
    });
    return;
  }

  await store.appendMessage({
    repoId: repo.id,
    role: "assistant",
    content: outcome.report || outcome.summary,
    createdAt: now().toISOString(),
  });
}
