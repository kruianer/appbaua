import { randomBytes } from "node:crypto";
import { getAuthStore } from "./auth-store";
import { SESSION_TTL_MS, type AuthSession } from "./auth-types";

// Session management (req-023). The cookie carries only an opaque session id
// — every other fact (which user, when it expires) lives server-side in the
// store, so a session can be revoked (logout) by deleting one row rather than
// having to invalidate a signed token.
//
// SESSION_COOKIE/SESSION_COOKIE_OPTIONS live in ./auth-cookie-name — re-export
// them here so every existing import of THIS module keeps working; the split
// exists only so middleware.ts (Edge runtime) can get the name without
// pulling in this file's node:crypto/auth-store chain.
export { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "./auth-cookie-name";

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Start a session for `userId`, returning the id to put in the cookie. */
export async function createSession(
  userId: string,
  now: () => Date = () => new Date(),
): Promise<string> {
  const session: AuthSession = {
    id: newToken(),
    userId,
    createdAt: now().toISOString(),
    expiresAt: new Date(now().getTime() + SESSION_TTL_MS).toISOString(),
  };
  await getAuthStore().createSession(session);
  return session.id;
}

/**
 * The user id a session cookie value resolves to, or null when the session is
 * missing or expired. Never throws — an invalid cookie is the same as no
 * cookie, the middleware's job is just to decide "authenticated or not".
 */
export async function userIdForSession(
  sessionId: string | undefined,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  if (!sessionId) return null;
  const session = await getAuthStore().getSession(sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= now().getTime()) return null;
  return session.userId;
}

/** End a session (logout). Deleting an already-gone id is a no-op, not an error. */
export async function endSession(sessionId: string): Promise<void> {
  await getAuthStore().deleteSession(sessionId);
}
