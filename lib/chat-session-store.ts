import { promises as fs } from "node:fs";
import path from "node:path";

// Persistence for the Chat conversations (req-040): one message log and one
// Claude session handle per repo. Same store-seam pattern as the other lists
// (store.ts): file for zero-infra dev, Postgres when configured, memory for
// tests.
//
// Time is injected by the caller (chat-session-manager), not generated here —
// this store is a dumb persistence layer, same split as run-log-store.ts.

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: number;
  repoId: string;
  role: ChatRole;
  content: string;
  createdAt: string; // ISO
  /**
   * req-049: die Schritte des Zugs, der zu DIESER Nachricht geführt hat —
   * nur bei der Antwort eines Zugs gesetzt (assistant/system), nie bei der
   * Nachricht des Nutzers selbst. So zeigt auch eine ältere Frage beim
   * Zurückrollen noch ihre eigenen Schritte, nicht nur die des zuletzt
   * gelaufenen Zugs.
   */
  steps?: string;
};

/**
 * One repo's live conversation handle: which Claude session the next turn
 * resumes, and when it was last used — the latter drives both the 5-session
 * cap (req-040 AC10) and the 8h idle timeout (AC12). `unread` is the Chat
 * nav button's Hinweispunkt (AC8/AC9): true once a turn finished while this
 * repo was not the one on screen, cleared when the operator opens it.
 */
export type ChatSession = {
  repoId: string;
  claudeSessionId: string;
  lastActiveAt: string; // ISO
  unread: boolean;
};

export interface ChatSessionStore {
  /** Oldest first — the order a conversation reads in. */
  listMessages(repoId: string): Promise<ChatMessage[]>;
  appendMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage>;
  getSession(repoId: string): Promise<ChatSession | null>;
  putSession(session: ChatSession): Promise<void>;
  /** Flip just the unread flag — lastActiveAt/claudeSessionId stay as they are. */
  setUnread(repoId: string, unread: boolean): Promise<void>;
  /** Every repo with its unread flag set, for the Chat nav button's badge. */
  listUnreadRepoIds(): Promise<string[]>;
}

type FileShape = {
  messages: ChatMessage[];
  sessions: Record<string, ChatSession>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "chat-sessions.json");

async function readAll(): Promise<FileShape> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
    };
  } catch {
    return { messages: [], sessions: {} };
  }
}

async function writeAll(data: FileShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function createFileChatSessionStore(): ChatSessionStore {
  return {
    async listMessages(repoId) {
      const all = await readAll();
      return all.messages.filter((m) => m.repoId === repoId);
    },
    async appendMessage(msg) {
      const all = await readAll();
      const nextId = all.messages.length
        ? Math.max(...all.messages.map((m) => m.id)) + 1
        : 1;
      const full: ChatMessage = { ...msg, id: nextId };
      all.messages.push(full);
      await writeAll(all);
      return full;
    },
    async getSession(repoId) {
      const all = await readAll();
      return all.sessions[repoId] ?? null;
    },
    async putSession(session) {
      const all = await readAll();
      all.sessions[session.repoId] = session;
      await writeAll(all);
    },
    async setUnread(repoId, unread) {
      const all = await readAll();
      const existing = all.sessions[repoId];
      if (!existing) return;
      all.sessions[repoId] = { ...existing, unread };
      await writeAll(all);
    },
    async listUnreadRepoIds() {
      const all = await readAll();
      return Object.values(all.sessions)
        .filter((s) => s.unread)
        .map((s) => s.repoId);
    },
  };
}

export function createMemoryChatSessionStore(): ChatSessionStore {
  let messages: ChatMessage[] = [];
  const sessions = new Map<string, ChatSession>();
  let seq = 0;
  return {
    async listMessages(repoId) {
      return messages.filter((m) => m.repoId === repoId);
    },
    async appendMessage(msg) {
      seq += 1;
      const full: ChatMessage = { ...msg, id: seq };
      messages = [...messages, full];
      return full;
    },
    async getSession(repoId) {
      return sessions.get(repoId) ?? null;
    },
    async putSession(session) {
      sessions.set(session.repoId, session);
    },
    async setUnread(repoId, unread) {
      const existing = sessions.get(repoId);
      if (!existing) return;
      sessions.set(repoId, { ...existing, unread });
    },
    async listUnreadRepoIds() {
      return [...sessions.values()].filter((s) => s.unread).map((s) => s.repoId);
    },
  };
}

function createDefaultChatSessionStore(): ChatSessionStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgChatSessionStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgChatSessionStore();
  }
  return createFileChatSessionStore();
}

let active: ChatSessionStore | null = null;

export function getChatSessionStore(): ChatSessionStore {
  if (!active) active = createDefaultChatSessionStore();
  return active;
}

export function setChatSessionStore(store: ChatSessionStore): void {
  active = store;
}
