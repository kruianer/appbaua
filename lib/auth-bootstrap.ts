import { randomBytes } from "node:crypto";
import { getAuthStore } from "./auth-store";
import { startRegistration, type RegistrationStart } from "./auth-webauthn";
import type { AuthUser } from "./auth-types";

// The operator bootstrap (req-023 AC1): in a fresh environment with no users
// at all, this creates the one operator user and starts a passkey
// registration ceremony for it. Deliberately NOT automatic/seeded — it only
// ever does anything when the user table is truly empty, so it cannot be used
// to sneak in a second operator later, and calling it again once a user
// exists is a no-op error, not a silent second bootstrap.

function newUserId(): string {
  return randomBytes(12).toString("base64url");
}

export type BootstrapResult =
  | { ok: true; registration: RegistrationStart }
  | { ok: false; error: "already-bootstrapped" };

/**
 * Create the operator user and begin their first passkey registration. Only
 * runs when the user table is empty — the reproduce-first check for the "no
 * offene Selbstregistrierung" requirement starts right here, not just at the
 * invitation flow.
 */
export async function bootstrapOperator(
  now: () => Date = () => new Date(),
): Promise<BootstrapResult> {
  const store = getAuthStore();
  if ((await store.countUsers()) > 0) {
    return { ok: false, error: "already-bootstrapped" };
  }
  const user: AuthUser = {
    id: newUserId(),
    isOperator: true,
    createdAt: now().toISOString(),
  };
  await store.createUser(user);
  const registration = await startRegistration(user.id, "Betreiber", now);
  return { ok: true, registration };
}
