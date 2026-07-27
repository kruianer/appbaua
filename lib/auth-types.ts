// Domain types for passkey auth (req-023). No I/O here — trivially
// unit-testable, shared between server and tests.
//
// Person ≠ operator context (livinggardentwin's leitprinzip, adapted): a
// User signs in with a passkey; is_operator marks the one operator this
// app is worked in the context of. n:m-capable in shape (a user row, not a
// hardcoded singleton), but not built out — invitations always come from
// the operator, there is no role system.

export type AuthUser = {
  id: string;
  isOperator: boolean;
  createdAt: string; // ISO
};

/** One registered passkey. A user may have several — one per device. */
export type AuthCredential = {
  id: string; // base64url credential ID, the WebAuthn-assigned identity
  userId: string;
  publicKey: string; // base64url COSE public key
  counter: number; // replay defence: must only ever increase
  transports: string[];
  createdAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type ChallengePurpose = "register" | "login";

/** A pending WebAuthn ceremony's server-generated challenge. */
export type AuthChallenge = {
  token: string;
  challenge: string;
  userId: string | null; // set when the ceremony is tied to a known user
  purpose: ChallengePurpose;
  expiresAt: string;
};

export type AuthInvitation = {
  token: string;
  createdBy: string; // operator's user id
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
};

/** One backup code. codeHash is null once consumed — never deleted, so
 * "how many are left" stays answerable without a separate counter. */
export type AuthBackupCode = {
  id: string;
  userId: string;
  codeHash: string | null;
  createdAt: string;
};

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
export const CHALLENGE_TTL_MS = 5 * 60_000; // 5 minutes: a ceremony is quick
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days
export const BACKUP_CODE_COUNT = 10;
