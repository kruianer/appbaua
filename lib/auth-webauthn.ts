import { randomBytes } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { getAuthStore } from "./auth-store";
import { appOrigin, rpId, RP_NAME } from "./webauthn-config";
import {
  CHALLENGE_TTL_MS,
  type AuthCredential,
  type ChallengePurpose,
} from "./auth-types";

// The WebAuthn ceremonies (req-023): registering a new passkey and logging in
// with one. Both are two-step "start/finish" pairs — start hands the browser
// a challenge and stores it server-side (auth_challenges), finish verifies
// what the browser signed against that same stored challenge. Storing the
// challenge in the DB rather than a cookie/session means the ceremony
// survives landing on a different server process between the two calls,
// which a stateless Next.js deployment does not guarantee against.

function newToken(): string {
  return randomBytes(16).toString("base64url");
}

async function storeChallenge(
  challenge: string,
  purpose: ChallengePurpose,
  userId: string | null,
  now: () => Date,
): Promise<string> {
  const token = newToken();
  await getAuthStore().createChallenge({
    token,
    challenge,
    userId,
    purpose,
    expiresAt: new Date(now().getTime() + CHALLENGE_TTL_MS).toISOString(),
  });
  return token;
}

/** Reads back a ceremony's challenge and consumes it (req-023: single-use). */
async function takeChallenge(
  token: string,
  purpose: ChallengePurpose,
  now: () => Date,
) {
  const found = await getAuthStore().consumeChallenge(token);
  if (!found) return null;
  if (found.purpose !== purpose) return null;
  if (new Date(found.expiresAt).getTime() <= now().getTime()) return null;
  return found;
}

// --- Registration --------------------------------------------------------

export type RegistrationStart = {
  token: string; // hand this back on finish
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
};

/**
 * Begin registering a new passkey for `userId` (a freshly bootstrapped
 * operator, or an invited user, or an existing user adding a second device).
 * `userName` is what the authenticator's own UI shows.
 */
export async function startRegistration(
  userId: string,
  userName: string,
  now: () => Date = () => new Date(),
): Promise<RegistrationStart> {
  const existing = await getAuthStore().listCredentialsForUser(userId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userName,
    userID: Buffer.from(userId, "utf8"),
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  const token = await storeChallenge(options.challenge, "register", userId, now);
  return { token, options };
}

export type FinishRegistrationResult =
  | { ok: true }
  | { ok: false; error: "no-ceremony" | "verification-failed" };

/**
 * Verify the browser's response and store the new passkey. `verifyImpl` is
 * injectable so tests can exercise the whole ceremony without a real
 * authenticator's cryptography (unit-testable per stack.md).
 */
export async function finishRegistration(
  token: string,
  response: RegistrationResponseJSON,
  now: () => Date = () => new Date(),
  verifyImpl: typeof verifyRegistrationResponse = verifyRegistrationResponse,
): Promise<FinishRegistrationResult> {
  const ceremony = await takeChallenge(token, "register", now);
  if (!ceremony || !ceremony.userId) return { ok: false, error: "no-ceremony" };

  const verification = await verifyImpl({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: appOrigin(),
    expectedRPID: rpId(),
  });
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "verification-failed" };
  }

  const { credential } = verification.registrationInfo;
  const stored: AuthCredential = {
    id: credential.id,
    userId: ceremony.userId,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    createdAt: now().toISOString(),
  };
  await getAuthStore().addCredential(stored);
  return { ok: true };
}

// --- Login -----------------------------------------------------------------

export type LoginStart = {
  token: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
};

/**
 * Begin a login ceremony. No target user yet — a passkey login is
 * "usernameless": the browser's own credential picker decides which
 * registered passkey to use, `finishLogin` learns who it belongs to from the
 * response's credential id.
 */
export async function startLogin(
  now: () => Date = () => new Date(),
): Promise<LoginStart> {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
  });
  const token = await storeChallenge(options.challenge, "login", null, now);
  return { token, options };
}

export type FinishLoginResult =
  | { ok: true; userId: string }
  | { ok: false; error: "no-ceremony" | "unknown-credential" | "verification-failed" };

/**
 * Verify the browser's response, update the replay counter, return who signed
 * in. `verifyImpl` is injectable — same reason as finishRegistration above.
 */
export async function finishLogin(
  token: string,
  response: AuthenticationResponseJSON,
  now: () => Date = () => new Date(),
  verifyImpl: typeof verifyAuthenticationResponse = verifyAuthenticationResponse,
): Promise<FinishLoginResult> {
  const ceremony = await takeChallenge(token, "login", now);
  if (!ceremony) return { ok: false, error: "no-ceremony" };

  const stored = await getAuthStore().getCredential(response.id);
  if (!stored) return { ok: false, error: "unknown-credential" };

  const verification = await verifyImpl({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: appOrigin(),
    expectedRPID: rpId(),
    credential: {
      id: stored.id,
      publicKey: Buffer.from(stored.publicKey, "base64url"),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransport[],
    },
  });
  if (!verification.verified) return { ok: false, error: "verification-failed" };

  await getAuthStore().updateCredentialCounter(
    stored.id,
    verification.authenticationInfo.newCounter,
  );
  return { ok: true, userId: stored.userId };
}
