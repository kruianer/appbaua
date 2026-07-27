import { randomBytes, createHash } from "node:crypto";
import { getAuthStore } from "./auth-store";
import { startRegistration, type RegistrationStart } from "./auth-webauthn";
import { BACKUP_CODE_COUNT, type AuthBackupCode } from "./auth-types";

// Recovery via backup codes (req-023): a user who lost their passkey device
// gets back in with one of BACKUP_CODE_COUNT one-time codes issued at
// registration. Codes are high-entropy on their own (10 random bytes,
// base32'd), so a plain SHA-256 hash is enough — this is not a low-entropy
// password that needs scrypt/bcrypt's deliberate slowness.

function newCode(): string {
  // 10 random bytes -> 16 base32 chars, split for readability: XXXX-XXXX-XXXX-XXXX
  const raw = randomBytes(10).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)!.join("-");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Issue a fresh set of backup codes for a user, replacing any they already
 * had (req-023: registering again invalidates the old set rather than
 * accumulating forever). Returns the codes in PLAIN TEXT — the only moment
 * they exist outside a hash — for the caller to show the user once.
 */
export async function issueBackupCodes(
  userId: string,
  now: () => Date = () => new Date(),
): Promise<string[]> {
  const store = getAuthStore();
  await store.clearBackupCodesForUser(userId);
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => newCode());
  const rows: AuthBackupCode[] = codes.map((code, i) => ({
    id: `${userId}-${now().getTime()}-${i}`,
    userId,
    codeHash: hashCode(code),
    createdAt: now().toISOString(),
  }));
  await store.addBackupCodes(rows);
  return codes;
}

export type BackupCodeStatus = { total: number; remaining: number };

/**
 * How many of a user's current backup codes are still unused (req-031: the
 * settings screen shows this without ever revealing the codes themselves
 * again — only `issueBackupCodes` returns plaintext).
 */
export async function backupCodeStatus(userId: string): Promise<BackupCodeStatus> {
  const codes = await getAuthStore().listBackupCodesForUser(userId);
  return {
    total: codes.length,
    remaining: codes.filter((c) => c.codeHash !== null).length,
  };
}

export type RecoveryResult =
  | { ok: true; userId: string; registration: RegistrationStart }
  | { ok: false; error: "invalid-code" };

/**
 * Redeem a backup code: find its owner by hash (a code carries no user id of
 * its own — it is presented alone, like a password), consume it, and start a
 * fresh passkey registration for the same user so a lost device gets
 * replaced.
 */
export async function redeemBackupCode(
  code: string,
  now: () => Date = () => new Date(),
): Promise<RecoveryResult> {
  const store = getAuthStore();
  const wanted = hashCode(code.trim().toUpperCase());
  const match = await store.findBackupCodeByHash(wanted);
  if (!match) return { ok: false, error: "invalid-code" };

  await store.consumeBackupCode(match.id);
  const registration = await startRegistration(
    match.userId,
    "Wiederhergestellter Zugang",
    now,
  );
  return { ok: true, userId: match.userId, registration };
}
