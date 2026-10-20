// Auth-expiry detection for Claude runs (bug-019). A run that fails because the
// worker's OAuth session for `claude` has expired is NOT a real failure of the
// .md it was working on: the requirement itself is fine, the worker just cannot
// authenticate until a human re-runs `claude login` inside the container. Every
// run after the first one hits the exact same wall, so — same as a rate limit
// (req-029) — the .md must not be parked to failed/ and the loop must not keep
// retrying it minutes apart.
//
// Kept pure and text-only so it is trivially testable and has no I/O.

import { appOrigin } from "./webauthn-config";

/**
 * How long to pause once auth has expired (bug-019). A rate limit resets by
 * itself; an expired login does not — it needs a human to run `claude login`
 * again. Retrying every few minutes would only fill the Verlauf with the same
 * message, so the pause is long rather than short (a later run, once logged in
 * again, works regardless of how much of the pause is left).
 */
export const AUTH_EXPIRED_PAUSE_MS = 6 * 60 * 60_000; // 6 hours

/**
 * What the Verlauf shows instead of the raw OAuth error text (bug-019): a
 * clear, actionable line the user can act on without having to decode an OAuth
 * message first.
 */
export const AUTH_EXPIRED_MESSAGE =
  "Anmeldung abgelaufen. Bitte im Worker-Container `claude login` ausführen " +
  "(z. B. `docker compose exec worker claude login`).";

/**
 * Phrases the CLI/API use for an expired or unrefreshable OAuth session.
 * Matched case-insensitively. Kept to auth-specific wording on purpose — unlike
 * rate-limit detection this must not fire on a run that failed for some other
 * reason, since the fix (re-login) would not help there.
 */
const AUTH_EXPIRED_PATTERNS = [
  /failed to authenticate/i,
  /oauth session expired/i,
  /session expired and could not be refreshed/i,
  /invalid_grant/i,
  /not authenticated/i,
];

/** Is this failure text an expired/unrefreshable OAuth session? */
export function isAuthExpired(text: string | null | undefined): boolean {
  if (!text) return false;
  return AUTH_EXPIRED_PATTERNS.some((re) => re.test(text));
}

/**
 * Welche der beiden Umgebungen (delivery/devops.md) gerade läuft — dieselbe
 * Unterscheidung, die APP_ORIGIN schon für den WebAuthn-rpId trifft
 * (webauthn-config.ts). Ohne gesetzten Wert (lokale Entwicklung) gilt "dev".
 */
function currentEnvironment(
  env: Record<string, string | undefined> = process.env,
): "dev" | "prod" {
  return appOrigin(env).includes("app.appbaua.com") ? "prod" : "dev";
}

/**
 * Der Worker-Container, in dem `claude login` für die gerade laufende
 * Umgebung wirkt (bug-031) — Compose benennt ihn `appbaua-<env>-worker-1`.
 */
export function authExpiredWorkerContainer(
  env: Record<string, string | undefined> = process.env,
): string {
  return `appbaua-${currentEnvironment(env)}-worker-1`;
}

/**
 * Was der Chat zeigt, wenn die Anmeldung abgelaufen ist (bug-031). Anders als
 * AUTH_EXPIRED_MESSAGE (für den Worker-Lauf) nennt diese Meldung den
 * Container der GERADE laufenden Umgebung: der Chat läuft im App-Container,
 * der das Volume nur lesend hat (bug-028) — anmelden muss man im
 * zugehörigen Worker-Container, und je Umgebung ist das ein anderer.
 * Der Befehl steht in einem Markdown-Codeblock, den die Chat-Oberfläche als
 * eigenes Kopierfeld zeigt (components/CopyCommand.tsx).
 */
export function authExpiredChatMessage(
  env: Record<string, string | undefined> = process.env,
): string {
  const container = authExpiredWorkerContainer(env);
  return (
    "Anmeldung abgelaufen. Im Worker-Container dieser Umgebung neu anmelden:\n\n" +
    `\`\`\`\ndocker exec -it ${container} claude login\n\`\`\``
  );
}
