import { cookies } from "next/headers";
import { createSession, endSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "./auth-session";

// Ties a session to the response cookie jar (req-023). Kept separate from
// auth-session.ts, which stays framework-free and unit-testable; this is the
// one place that touches next/headers.

/** Start a session for userId and set the cookie on the current response. */
export async function signIn(userId: string): Promise<void> {
  const sessionId = await createSession(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTIONS);
}

/** End the current session (if any) and clear the cookie. */
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  if (sessionId) await endSession(sessionId);
  jar.delete(SESSION_COOKIE);
}
