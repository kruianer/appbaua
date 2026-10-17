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
};

/**
 * One repo's live conversation handle: which Claude session the next turn
 * resumes, and when it was last used — the latter drives both the 5-session
 * cap (req-040 AC10) and the 8h idle timeout (AC12).
 */
export type ChatSession = {
  repoId: string;
  claudeSessionId: string;
  lastActiveAt: string; // ISO
};

export interface ChatSessionStore {
  /** Oldest first — the order a conversation reads in. */
  listMessages(repoId: string): Promise<ChatMessage[]>;
  appendMessage(msg: Omit<ChatMessage, "id">): Promise<ChatMessage>;
  getSession(repoId: string): Promise<ChatSession | null>;
  putSession(session: ChatSession): Promise<void>;
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
