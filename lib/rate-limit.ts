// Rate-limit detection for Claude runs (req-029). A run that failed because the
// account hit a usage/rate limit is NOT a real failure: the requirement is fine,
// the worker just has to wait and try again later. This module decides, from the
// text a failed Claude run left behind, whether that is what happened — and until
// when to wait.
//
// Kept pure and text-only so it is trivially testable and has no I/O.

/** How long to pause when a rate limit is seen but names no reset time (req-029). */
export const DEFAULT_RATE_LIMIT_PAUSE_MS = 60 * 60_000; // 1 hour

/**
 * Phrases that mark a rate-/usage-limit in the CLI/API output. Matched
 * case-insensitively. Kept broad on purpose: a missed limit costs a wrong
 * "failed", which is exactly what req-029 is here to avoid.
 */
const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /usage limit/i,
  /too many requests/i,
  /\b429\b/,
  /quota (?:exceeded|reached)/i,
  /overloaded/i,
];

/** Is this failure text a rate/usage limit? */
export function isRateLimit(text: string | null | undefined): boolean {
  if (!text) return false;
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

/**
 * The reset instant a rate-limit message names, as epoch ms, or null when it
 * names none. Recognises two shapes the CLI/API use:
 *   - a unix timestamp, e.g. "try again at 1753560000" / "resets 1753560000"
 *   - an ISO-8601 instant, e.g. "resets at 2026-07-26T21:00:00Z"
 * A timestamp in the past is ignored (returns null), so a stale number can never
 * shorten the pause below the sensible default.
 */
export function resetAtFrom(
  text: string | null | undefined,
  nowMs: number,
): number | null {
  if (!text) return null;

  // ISO-8601 first: it also contains digits, so try the stricter shape before
  // the bare-number fallback.
  const iso = text.match(
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/,
  );
  if (iso) {
    const ms = Date.parse(iso[0]);
    if (!Number.isNaN(ms) && ms > nowMs) return ms;
  }

  // A unix timestamp near a reset word. Seconds (10 digits) or ms (13 digits).
  const unix = text.match(
    /(?:reset|resets|try again|retry|available)[^0-9]{0,20}(\d{10,13})/i,
  );
  if (unix) {
    const raw = Number(unix[1]);
    const ms = unix[1].length <= 10 ? raw * 1000 : raw;
    if (ms > nowMs) return ms;
  }

  return null;
}

/**
 * When the worker should resume after a rate-limited run: the reset instant the
 * message named, or now + the default pause when it named none (req-029).
 * Returned as epoch ms.
 */
export function pauseUntilFrom(
  text: string | null | undefined,
  nowMs: number,
): number {
  return resetAtFrom(text, nowMs) ?? nowMs + DEFAULT_RATE_LIMIT_PAUSE_MS;
}
