import { finishRegistration } from "./auth-webauthn";
import { getAuthStore } from "./auth-store";
import { signIn } from "./auth-cookie";
import { issueBackupCodes } from "./auth-recovery";

// Shared by every "finish registering a passkey, then sign in" route
// (bootstrap, invitation redemption, recovery) — three call sites doing the
// same verify-then-look-up-owner-then-sign-in sequence.
//
// A first passkey ALSO gets a fresh set of backup codes (req-023 recovery):
// registering again re-issues them (auth-recovery's own rule), so a caller
// registering a SECOND device for an already-set-up user does not silently
// invalidate codes they may still need — only pass `withBackupCodes: true`
// for a ceremony that is that user's first credential.

export async function finishRegistrationAndSignIn(
  token: string,
  response: Parameters<typeof finishRegistration>[1],
  opts: { withBackupCodes?: boolean } = {},
): Promise<
  { ok: true; backupCodes: string[] | null } | { ok: false; error: string }
> {
  const result = await finishRegistration(token, response);
  if (!result.ok) return { ok: false, error: result.error };

  const cred = await getAuthStore().getCredential(response.id);
  if (!cred) return { ok: false, error: "verification-failed" };

  await signIn(cred.userId);
  const backupCodes = opts.withBackupCodes
    ? await issueBackupCodes(cred.userId)
    : null;
  return { ok: true, backupCodes };
}
