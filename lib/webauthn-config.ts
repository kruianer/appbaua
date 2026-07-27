// rpId/Origin configuration for WebAuthn (req-023). Passkeys are bound to the
// domain they were registered on — a dev passkey must not work on prod and
// vice versa, so this is read from an environment variable per deployment
// (dev.appbaua.com vs. app.appbaua.com, delivery/devops.md), never hardcoded.
//
// APP_ORIGIN is the single source: rpId is derived from it (the hostname),
// origin is the value itself. Local dev without the var set falls back to
// localhost, which WebAuthn treats as a secure context on its own (stack.md).

const DEFAULT_ORIGIN = "http://localhost:3000";

/** The full origin this deployment is reachable at, e.g. "https://app.appbaua.com". */
export function appOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.APP_ORIGIN?.trim();
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_ORIGIN;
}

/** The WebAuthn relying-party ID: the origin's bare hostname, no scheme/port. */
export function rpId(env: Record<string, string | undefined> = process.env): string {
  return new URL(appOrigin(env)).hostname;
}

/** Human-facing name shown by the authenticator's own UI during a ceremony. */
export const RP_NAME = "appbaua";
