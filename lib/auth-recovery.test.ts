import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryAuthStore, setAuthStore, getAuthStore } from "./auth-store";
import {
  issueBackupCodes,
  redeemBackupCode,
  backupCodeStatus,
} from "./auth-recovery";
import { BACKUP_CODE_COUNT } from "./auth-types";

const NOW = new Date(2026, 6, 27, 10, 0, 0);

beforeEach(() => {
  setAuthStore(createMemoryAuthStore());
});

describe("issueBackupCodes (req-023)", () => {
  it(`issues ${BACKUP_CODE_COUNT} distinct plaintext codes`, async () => {
    const codes = await issueBackupCodes("u1", () => NOW);
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT); // all distinct
  });

  it("stores only hashes, never the plaintext code", async () => {
    const codes = await issueBackupCodes("u1", () => NOW);
    const stored = await getAuthStore().listBackupCodesForUser("u1");
    for (const c of stored) {
      expect(c.codeHash).not.toBeNull();
      expect(codes).not.toContain(c.codeHash); // hash, not plaintext
    }
  });

  it("re-issuing invalidates the previous set (req-023: no unbounded accumulation)", async () => {
    const first = await issueBackupCodes("u1", () => NOW);
    await issueBackupCodes("u1", () => NOW);
    const result = await redeemBackupCode(first[0], () => NOW);
    expect(result).toEqual({ ok: false, error: "invalid-code" });
  });
});

describe("redeemBackupCode (req-023)", () => {
  it("AC: a valid, unused code grants access and starts a fresh registration", async () => {
    const codes = await issueBackupCodes("u1", () => NOW);
    const result = await redeemBackupCode(codes[0], () => NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe("u1");
    expect(result.registration.token).toBeTruthy();
  });

  it("a code cannot be redeemed twice", async () => {
    const codes = await issueBackupCodes("u1", () => NOW);
    await redeemBackupCode(codes[0], () => NOW);
    const second = await redeemBackupCode(codes[0], () => NOW);
    expect(second).toEqual({ ok: false, error: "invalid-code" });
  });

  it("an unknown code is rejected", async () => {
    const result = await redeemBackupCode("NOPE-NOPE-NOPE-NOPE", () => NOW);
    expect(result).toEqual({ ok: false, error: "invalid-code" });
  });

  it("is case-insensitive and trims whitespace (users retype these by hand)", async () => {
    const codes = await issueBackupCodes("u1", () => NOW);
    const messy = ` ${codes[0].toLowerCase()} `;
    const result = await redeemBackupCode(messy, () => NOW);
    expect(result.ok).toBe(true);
  });
});

describe("backupCodeStatus (req-031)", () => {
  it("AC: reports all codes unused right after issuing", async () => {
    await issueBackupCodes("u1", () => NOW);
    const status = await backupCodeStatus("u1");
    expect(status).toEqual({ total: BACKUP_CODE_COUNT, remaining: BACKUP_CODE_COUNT });
  });

  it("AC: reports fewer remaining as codes are redeemed", async () => {
    const codes = await issueBackupCodes("u1", () => NOW);
    await redeemBackupCode(codes[0], () => NOW);
    await redeemBackupCode(codes[1], () => NOW);
    await redeemBackupCode(codes[2], () => NOW);
    const status = await backupCodeStatus("u1");
    expect(status).toEqual({ total: BACKUP_CODE_COUNT, remaining: BACKUP_CODE_COUNT - 3 });
  });

  it("a user with no codes yet reports 0 of 0", async () => {
    const status = await backupCodeStatus("nobody");
    expect(status).toEqual({ total: 0, remaining: 0 });
  });

  it("re-issuing resets the count back to fully unused", async () => {
    const first = await issueBackupCodes("u1", () => NOW);
    await redeemBackupCode(first[0], () => NOW);
    await issueBackupCodes("u1", () => NOW);
    const status = await backupCodeStatus("u1");
    expect(status).toEqual({ total: BACKUP_CODE_COUNT, remaining: BACKUP_CODE_COUNT });
  });
});
