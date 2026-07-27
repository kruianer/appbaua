// Just the cookie name/options (req-023) — split out from auth-session.ts on
// purpose: middleware.ts runs in the Edge runtime and cannot import anything
// that pulls in node:crypto/fs/path (which auth-session.ts does via
// auth-store.ts). This file has zero such imports, so it is safe on both
// sides — Edge middleware and the normal server runtime.

export const SESSION_COOKIE = "appbaua_session";

/** Cookie options shared by every place that sets or clears the session cookie. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
