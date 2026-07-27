import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./auth-session";
import { userIdForSession } from "./auth-session";
import { getAuthStore } from "./auth-store";
import type { AuthUser } from "./auth-types";

// Server-side helper for API routes: who (if anyone) the request's session
// cookie belongs to. Shared by every route handler that needs to know the
// caller — the middleware (req-023) enforces that a session exists at all,
// this answers the finer question "is this caller the operator".

/** The authenticated user for the current request, or null. */
export async function currentUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  const userId = await userIdForSession(sessionId);
  if (!userId) return null;
  return getAuthStore().getUser(userId);
}
