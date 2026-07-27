import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./lib/auth-session";

// req-023: guards the whole app. Without a valid session, only the
// anmelde-/registrierungs-/recovery surface is reachable — everything else
// (the worker controls this app steers) redirects to /login. Middleware can
// only check that the cookie NAMES a session, not whether the store still
// has it (Edge runtime has no direct Postgres access) — the real check
// happens in the auth API routes and page server components, same as every
// other store read in this app. A stale/forged cookie value still gets
// bounced at that second check, so this is defence in depth, not the only
// gate.

/**
 * Paths reachable without a session: the auth pages themselves, their APIs,
 * and Next.js' own static assets. Everything else needs the cookie.
 */
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/recovery",
  "/api/auth",
];

export function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Exclude Next's own static/image pipeline; everything else is checked
  // above (isPublic carves out the auth surface from inside the handler,
  // which keeps ALL the "what's public" logic in one readable place instead
  // of split across this matcher and the function body).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
