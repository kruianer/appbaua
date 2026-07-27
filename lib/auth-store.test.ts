import { describe, it, expect } from "vitest";
import { createMemoryAuthStore } from "./auth-store";
import type {
  AuthUser,
  AuthCredential,
  AuthSession,
  AuthChallenge,
  AuthInvitation,
  AuthBackupCode,
} from "./auth-types";

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: "u1",
  isOperator: false,
  createdAt: "2026-07-27T10:00:00.000Z",
  ...over,
});

describe("AuthStore — users (req-023)", () => {
  it("creates and reads a user back", async () => {
    const store = createMemoryAuthStore();
    await store.createUser(user());
    expect(await store.getUser("u1")).toEqual(user());
  });

  it("countUsers reflects how many exist", async () => {
    const store = createMemoryAuthStore();
    expect(await store.countUsers()).toBe(0);
    await store.createUser(user());
    expect(await store.countUsers()).toBe(1);
  });

  it("getOperator finds the operator-flagged user, none if there is none", async () => {
    const store = createMemoryAuthStore();
    await store.createUser(user({ id: "u1", isOperator: false }));
    expect(await store.getOperator()).toBeNull();
    await store.createUser(user({ id: "u2", isOperator: true }));
    expect((await store.getOperator())?.id).toBe("u2");
  });
});

describe("AuthStore — credentials (req-023)", () => {
  const cred = (over: Partial<AuthCredential> = {}): AuthCredential => ({
    id: "cred1",
    userId: "u1",
    publicKey: "pk",
    counter: 0,
    transports: ["internal"],
    createdAt: "2026-07-27T10:00:00.000Z",
    ...over,
  });

  it("adds and reads a credential back", async () => {
    const store = createMemoryAuthStore();
    await store.addCredential(cred());
    expect(await store.getCredential("cred1")).toEqual(cred());
  });

  it("lists only the credentials belonging to the given user", async () => {
    const store = createMemoryAuthStore();
    await store.addCredential(cred({ id: "c1", userId: "u1" }));
    await store.addCredential(cred({ id: "c2", userId: "u2" }));
    const forU1 = await store.listCredentialsForUser("u1");
    expect(forU1.map((c) => c.id)).toEqual(["c1"]);
  });

  it("updates the counter in place (replay defence)", async () => {
    const store = createMemoryAuthStore();
    await store.addCredential(cred({ counter: 0 }));
    await store.updateCredentialCounter("cred1", 5);
    expect((await store.getCredential("cred1"))?.counter).toBe(5);
  });
});

describe("AuthStore — sessions (req-023)", () => {
  const session = (over: Partial<AuthSession> = {}): AuthSession => ({
    id: "sess1",
    userId: "u1",
    createdAt: "2026-07-27T10:00:00.000Z",
    expiresAt: "2026-08-26T10:00:00.000Z",
    ...over,
  });

  it("creates, reads and deletes a session", async () => {
    const store = createMemoryAuthStore();
    await store.createSession(session());
    expect(await store.getSession("sess1")).toEqual(session());
    await store.deleteSession("sess1");
    expect(await store.getSession("sess1")).toBeNull();
  });
});

describe("AuthStore — challenges (req-023)", () => {
  const challenge = (over: Partial<AuthChallenge> = {}): AuthChallenge => ({
    token: "tok1",
    challenge: "base64url-challenge",
    userId: null,
    purpose: "register",
    expiresAt: "2026-07-27T10:05:00.000Z",
    ...over,
  });

  it("consumeChallenge reads AND deletes it — a second consume finds nothing", async () => {
    const store = createMemoryAuthStore();
    await store.createChallenge(challenge());
    const first = await store.consumeChallenge("tok1");
    expect(first).toEqual(challenge());
    const second = await store.consumeChallenge("tok1");
    expect(second).toBeNull();
  });
});

describe("AuthStore — invitations (req-023)", () => {
  const invitation = (over: Partial<AuthInvitation> = {}): AuthInvitation => ({
    token: "inv1",
    createdBy: "operator1",
    createdAt: "2026-07-27T10:00:00.000Z",
    expiresAt: "2026-08-03T10:00:00.000Z",
    usedAt: null,
    ...over,
  });

  it("creates an invitation and marks it used", async () => {
    const store = createMemoryAuthStore();
    await store.createInvitation(invitation());
    expect((await store.getInvitation("inv1"))?.usedAt).toBeNull();
    await store.markInvitationUsed("inv1", "2026-07-28T09:00:00.000Z");
    expect((await store.getInvitation("inv1"))?.usedAt).toBe(
      "2026-07-28T09:00:00.000Z",
    );
  });

  it("an unknown token returns null, not a throw", async () => {
    const store = createMemoryAuthStore();
    expect(await store.getInvitation("nope")).toBeNull();
  });
});

describe("AuthStore — backup codes (req-023)", () => {
  const code = (over: Partial<AuthBackupCode> = {}): AuthBackupCode => ({
    id: "bc1",
    userId: "u1",
    codeHash: "hash1",
    createdAt: "2026-07-27T10:00:00.000Z",
    ...over,
  });

  it("adds several codes and lists them for the user", async () => {
    const store = createMemoryAuthStore();
    await store.addBackupCodes([
      code({ id: "bc1" }),
      code({ id: "bc2" }),
      code({ id: "bc3", userId: "other" }),
    ]);
    const mine = await store.listBackupCodesForUser("u1");
    expect(mine.map((c) => c.id)).toEqual(["bc1", "bc2"]);
  });

  it("consuming a code clears its hash but keeps the row (single-use, not deleted)", async () => {
    const store = createMemoryAuthStore();
    await store.addBackupCodes([code()]);
    await store.consumeBackupCode("bc1");
    const mine = await store.listBackupCodesForUser("u1");
    expect(mine).toHaveLength(1);
    expect(mine[0].codeHash).toBeNull();
  });

  it("clearBackupCodesForUser removes only that user's codes", async () => {
    const store = createMemoryAuthStore();
    await store.addBackupCodes([
      code({ id: "bc1", userId: "u1" }),
      code({ id: "bc2", userId: "u2" }),
    ]);
    await store.clearBackupCodesForUser("u1");
    expect(await store.listBackupCodesForUser("u1")).toHaveLength(0);
    expect(await store.listBackupCodesForUser("u2")).toHaveLength(1);
  });
});
