import { promises as fs } from "node:fs";
import path from "node:path";

// Persistence for Chat-UI state (req-040): currently just which repo was last
// open, so the Chat tab preselects it next time instead of defaulting to the
// first repo in the list. Same store-seam pattern as the other singletons
// (worker-state.ts): file-backed for zero-infra dev, Postgres when
// configured, memory for tests.

export interface ChatUiStateStore {
  getActiveRepoId(): Promise<string | null>;
  setActiveRepoId(repoId: string): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "chat-ui-state.json");

export function createFileChatUiStateStore(): ChatUiStateStore {
  return {
    async getActiveRepoId() {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.activeRepoId === "string" ? parsed.activeRepoId : null;
      } catch {
        return null;
      }
    },
    async setActiveRepoId(repoId) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(
        DATA_FILE,
        JSON.stringify({ activeRepoId: repoId }, null, 2),
        "utf8",
      );
    },
  };
}

export function createMemoryChatUiStateStore(
  initial: string | null = null,
): ChatUiStateStore {
  let activeRepoId = initial;
  return {
    async getActiveRepoId() {
      return activeRepoId;
    },
    async setActiveRepoId(repoId) {
      activeRepoId = repoId;
    },
  };
}

function createDefaultChatUiStateStore(): ChatUiStateStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgChatUiStateStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgChatUiStateStore();
  }
  return createFileChatUiStateStore();
}

let active: ChatUiStateStore | null = null;

export function getChatUiStateStore(): ChatUiStateStore {
  if (!active) active = createDefaultChatUiStateStore();
  return active;
}

export function setChatUiStateStore(store: ChatUiStateStore): void {
  active = store;
}
