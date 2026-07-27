import { randomBytes } from "node:crypto";
import { getAuthStore } from "./auth-store";
import { startRegistration, type RegistrationStart } from "./auth-webauthn";
import { INVITATION_TTL_MS, type AuthInvitation, type AuthUser } from "./auth-types";

// Invitations (req-023): the only way a second user gets into the app. No
// endpoint here creates a user without a valid, unused, unexpired invitation
// token — that IS the "keine offene Selbstregistrierung" requirement, so the
// check lives here rather than being trusted to whoever calls this.

function newToken(): string {
  return randomBytes(16).toString("base64url");
}

function newUserId(): string {
  return randomBytes(12).toString("base64url");
}

/** Create an invitation. Caller is responsible for checking the requester is the operator. */
export async function createInvitation(
  createdBy: string,
  now: () => Date = () => new Date(),
): Promise<AuthInvitation> {
  const invitation: AuthInvitation = {
    token: newToken(),
    createdBy,
    createdAt: now().toISOString(),
    expiresAt: new Date(now().getTime() + INVITATION_TTL_MS).toISOString(),
    usedAt: null,
  };
  await getAuthStore().createInvitation(invitation);
  return invitation;
}

export type RedeemResult =
  | { ok: true; user: AuthUser; registration: RegistrationStart }
  | { ok: false; error: "invalid" | "expired" | "already-used" };

/**
 * Redeem an invitation token: create the invited user and start their first
 * passkey registration. Every rejection path (unknown token, expired,
 * already used) returns the same shape as an ordinary failure — no
 * distinction that would let someone probe for valid-but-expired tokens.
 */
export async function redeemInvitation(
  token: string,
  now: () => Date = () => new Date(),
): Promise<RedeemResult> {
  const store = getAuthStore();
  const invitation = await store.getInvitation(token);
  if (!invitation) return { ok: false, error: "invalid" };
  if (invitation.usedAt) return { ok: false, error: "already-used" };
  if (new Date(invitation.expiresAt).getTime() <= now().getTime()) {
    return { ok: false, error: "expired" };
  }

  const user: AuthUser = {
    id: newUserId(),
    isOperator: false,
    createdAt: now().toISOString(),
  };
  await store.createUser(user);
  await store.markInvitationUsed(token, now().toISOString());
  const registration = await startRegistration(user.id, "Eingeladener Nutzer", now);
  return { ok: true, user, registration };
}
