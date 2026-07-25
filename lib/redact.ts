// Credential scrubbing for everything that leaves the worker as text (bug-003):
// run-log messages, the live output tail, and with them the UI.
//
// git puts the remote URL into a lot of its error messages, and whether a given
// git version strips the userinfo part of that URL is version-dependent — so we
// strip it ourselves, right before the text is handed on.
//
// Two layers, on purpose:
//   1. secrets we actually hold (the PAT, plus the Basic-auth blob built from
//      it) are replaced literally, which catches them in any shape;
//   2. generic credential shapes are replaced by pattern, which also catches a
//      token we never knew about — e.g. one echoed by a tool we called.

/** What a removed credential is replaced with. */
export const REDACTED = "***";

/** Credential shapes and what replaces them. */
const RULES: [RegExp, string][] = [
  // userinfo in a URL: https://x-access-token:ghp_xxx@github.com/owner/repo.git
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, `$1${REDACTED}@`],
  // GitHub fine-grained PATs
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  // classic PATs and OAuth/app/user/refresh tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  // an Authorization header, however it is spelled
  [/\b(authorization:\s*(?:basic|bearer|token)\s+)\S+/gi, `$1${REDACTED}`],
];

/**
 * Shorter strings are not replaced literally: a three-character "token" would
 * blank out half the message without hiding anything.
 */
const MIN_SECRET_LENGTH = 8;

/** Env vars that may hold a credential this process passes to git. */
const SECRET_ENV_VARS = ["GITHUB_TOKEN", "GH_TOKEN"];

/**
 * Every form a secret takes on the wire: itself, and the Basic-auth blob git
 * sends it as (see `basicAuthHeader` in workspace.ts).
 */
function shapes(secret: string): string[] {
  return [
    secret,
    Buffer.from(`x-access-token:${secret}`, "utf8").toString("base64"),
  ];
}

/**
 * Secrets this process holds. Read on every call rather than once at import,
 * so a token set later (or swapped in a test) is still covered.
 */
function processSecrets(): string[] {
  return SECRET_ENV_VARS.flatMap((name) => {
    const value = process.env[name];
    return value ? shapes(value) : [];
  });
}

/**
 * Remove credentials from `text`. `extraSecrets` are secrets the caller holds
 * right there — a git helper knows the token it just used, so it does not have
 * to rely on the environment matching.
 */
export function redact(text: string, extraSecrets: string[] = []): string {
  if (!text) return text;
  let out = text;
  const secrets = [...extraSecrets.flatMap(shapes), ...processSecrets()];
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    out = out.split(secret).join(REDACTED);
  }
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
