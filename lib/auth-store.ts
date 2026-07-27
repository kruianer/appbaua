import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AuthUser,
  AuthCredential,
  AuthSession,
  AuthChallenge,
  AuthInvitation,
  AuthBackupCode,
} from "./auth-types";

// Persistence for passkey auth (req-023). Same seam pattern as the other
// stores: one JSON file for zero-infra dev, Postgres when configured, memory
// for tests. Unlike the single-list stores, this is several small entities
// together — a login ceremony touches users, credentials AND a challenge in
// one request, so one store keeping them consistent is simpler than five.

export interface AuthStore {
  // Users
  createUser(user: AuthUser): Promise<AuthUser>;
  getUser(id: string): Promise<AuthUser | null>;
  countUsers(): Promise<number>;
  getOperator(): Promise<AuthUser | null>;

  // Credentials
  addCredential(cred: AuthCredential): Promise<void>;
  getCredential(id: string): Promise<AuthCredential | null>;
  listCredentialsForUser(userId: string): Promise<AuthCredential[]>;
  updateCredentialCounter(id: string, counter: number): Promise<void>;

  // Sessions
  createSession(session: AuthSession): Promise<void>;
  getSession(id: string): Promise<AuthSession | null>;
  deleteSession(id: string): Promise<void>;

  // Challenges (WebAuthn ceremony state)
  createChallenge(challenge: AuthChallenge): Promise<void>;
  consumeChallenge(token: string): Promise<AuthChallenge | null>; // read + delete

  // Invitations
  createInvitation(invitation: AuthInvitation): Promise<void>;
  getInvitation(token: string): Promise<AuthInvitation | null>;
  markInvitationUsed(token: string, usedAt: string): Promise<void>;

  // Backup codes
  addBackupCodes(codes: AuthBackupCode[]): Promise<void>;
  listBackupCodesForUser(userId: string): Promise<AuthBackupCode[]>;
  /** The still-valid (not yet consumed) code whose hash matches, or null. */
  findBackupCodeByHash(codeHash: string): Promise<AuthBackupCode | null>;
  consumeBackupCode(id: string): Promise<void>; // sets codeHash to null
  clearBackupCodesForUser(userId: string): Promise<void>;
}

type FileShape = {
  users: AuthUser[];
  credentials: AuthCredential[];
  sessions: AuthSession[];
  challenges: AuthChallenge[];
  invitations: AuthInvitation[];
  backupCodes: AuthBackupCode[];
};

const EMPTY_SHAPE: FileShape = {
  users: [],
  credentials: [],
  sessions: [],
  challenges: [],
  invitations: [],
  backupCodes: [],
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "auth.json");

export function createFileAuthStore(): AuthStore {
  async function readAll(): Promise<FileShape> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      return { ...EMPTY_SHAPE, ...JSON.parse(raw) };
    } catch {
      return { ...EMPTY_SHAPE };
    }
  }
  async function writeAll(shape: FileShape): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(shape, null, 2), "utf8");
  }

  return {
    async createUser(user) {
      const s = await readAll();
      s.users.push(user);
      await writeAll(s);
      return user;
    },
    async getUser(id) {
      const s = await readAll();
      return s.users.find((u) => u.id === id) ?? null;
    },
    async countUsers() {
      return (await readAll()).users.length;
    },
    async getOperator() {
      const s = await readAll();
      return s.users.find((u) => u.isOperator) ?? null;
    },

    async addCredential(cred) {
      const s = await readAll();
      s.credentials.push(cred);
      await writeAll(s);
    },
    async getCredential(id) {
      const s = await readAll();
      return s.credentials.find((c) => c.id === id) ?? null;
    },
    async listCredentialsForUser(userId) {
      const s = await readAll();
      return s.credentials.filter((c) => c.userId === userId);
    },
    async updateCredentialCounter(id, counter) {
      const s = await readAll();
      const c = s.credentials.find((c) => c.id === id);
      if (c) c.counter = counter;
      await writeAll(s);
    },

    async createSession(session) {
      const s = await readAll();
      s.sessions.push(session);
      await writeAll(s);
    },
    async getSession(id) {
      const s = await readAll();
      return s.sessions.find((x) => x.id === id) ?? null;
    },
    async deleteSession(id) {
      const s = await readAll();
      s.sessions = s.sessions.filter((x) => x.id !== id);
      await writeAll(s);
    },

    async createChallenge(challenge) {
      const s = await readAll();
      s.challenges.push(challenge);
      await writeAll(s);
    },
    async consumeChallenge(token) {
      const s = await readAll();
      const found = s.challenges.find((c) => c.token === token) ?? null;
      s.challenges = s.challenges.filter((c) => c.token !== token);
      await writeAll(s);
      return found;
    },

    async createInvitation(invitation) {
      const s = await readAll();
      s.invitations.push(invitation);
      await writeAll(s);
    },
    async getInvitation(token) {
      const s = await readAll();
      return s.invitations.find((i) => i.token === token) ?? null;
    },
    async markInvitationUsed(token, usedAt) {
      const s = await readAll();
      const inv = s.invitations.find((i) => i.token === token);
      if (inv) inv.usedAt = usedAt;
      await writeAll(s);
    },

    async addBackupCodes(codes) {
      const s = await readAll();
      s.backupCodes.push(...codes);
      await writeAll(s);
    },
    async listBackupCodesForUser(userId) {
      const s = await readAll();
      return s.backupCodes.filter((c) => c.userId === userId);
    },
    async findBackupCodeByHash(codeHash) {
      const s = await readAll();
      return s.backupCodes.find((c) => c.codeHash === codeHash) ?? null;
    },
    async consumeBackupCode(id) {
      const s = await readAll();
      const c = s.backupCodes.find((c) => c.id === id);
      if (c) c.codeHash = null;
      await writeAll(s);
    },
    async clearBackupCodesForUser(userId) {
      const s = await readAll();
      s.backupCodes = s.backupCodes.filter((c) => c.userId !== userId);
      await writeAll(s);
    },
  };
}

export function createMemoryAuthStore(): AuthStore {
  const s: FileShape = {
    users: [],
    credentials: [],
    sessions: [],
    challenges: [],
    invitations: [],
    backupCodes: [],
  };
  return {
    async createUser(user) {
      s.users.push(user);
      return user;
    },
    async getUser(id) {
      return s.users.find((u) => u.id === id) ?? null;
    },
    async countUsers() {
      return s.users.length;
    },
    async getOperator() {
      return s.users.find((u) => u.isOperator) ?? null;
    },

    async addCredential(cred) {
      s.credentials.push(cred);
    },
    async getCredential(id) {
      return s.credentials.find((c) => c.id === id) ?? null;
    },
    async listCredentialsForUser(userId) {
      return s.credentials.filter((c) => c.userId === userId);
    },
    async updateCredentialCounter(id, counter) {
      const c = s.credentials.find((c) => c.id === id);
      if (c) c.counter = counter;
    },

    async createSession(session) {
      s.sessions.push(session);
    },
    async getSession(id) {
      return s.sessions.find((x) => x.id === id) ?? null;
    },
    async deleteSession(id) {
      s.sessions = s.sessions.filter((x) => x.id !== id);
    },

    async createChallenge(challenge) {
      s.challenges.push(challenge);
    },
    async consumeChallenge(token) {
      const found = s.challenges.find((c) => c.token === token) ?? null;
      s.challenges = s.challenges.filter((c) => c.token !== token);
      return found;
    },

    async createInvitation(invitation) {
      s.invitations.push(invitation);
    },
    async getInvitation(token) {
      return s.invitations.find((i) => i.token === token) ?? null;
    },
    async markInvitationUsed(token, usedAt) {
      const inv = s.invitations.find((i) => i.token === token);
      if (inv) inv.usedAt = usedAt;
    },

    async addBackupCodes(codes) {
      s.backupCodes.push(...codes);
    },
    async listBackupCodesForUser(userId) {
      return s.backupCodes.filter((c) => c.userId === userId);
    },
    async findBackupCodeByHash(codeHash) {
      return s.backupCodes.find((c) => c.codeHash === codeHash) ?? null;
    },
    async consumeBackupCode(id) {
      const c = s.backupCodes.find((c) => c.id === id);
      if (c) c.codeHash = null;
    },
    async clearBackupCodesForUser(userId) {
      s.backupCodes = s.backupCodes.filter((c) => c.userId !== userId);
    },
  };
}

function createDefaultAuthStore(): AuthStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgAuthStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgAuthStore();
  }
  return createFileAuthStore();
}

let active: AuthStore | null = null;

export function getAuthStore(): AuthStore {
  if (!active) active = createDefaultAuthStore();
  return active;
}

export function setAuthStore(store: AuthStore): void {
  active = store;
}
