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
  /session limit/i,
  /limit (?:reached|exceeded)/i,
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
 * names none. Recognises three shapes the CLI/API use:
 *   - a unix timestamp, e.g. "try again at 1753560000" / "resets 1753560000"
 *   - an ISO-8601 instant, e.g. "resets at 2026-07-26T21:00:00Z"
 *   - a 12-hour clock with a UTC marker, e.g. "resets 10:50pm (UTC)" — the
 *     shape the CLI's session-limit message uses (bug-011)
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

  // A 12-hour clock next to a reset word, with an explicit UTC/GMT marker
  // (bug-011): "resets 10:50pm (UTC)". Only UTC/GMT are recognised — any other
  // zone name would need an offset table the message never provides. The date
  // is today-in-UTC unless that has already passed, in which case it is
  // tomorrow — the message never names a date, only a time.
  const clock12 = text.match(
    /(?:reset|resets)[^0-9]{0,10}(\d{1,2}):(\d{2})\s*([ap]m)\b[^)]{0,10}\((?:UTC|GMT)\)/i,
  );
  if (clock12) {
    const hour12 = Number(clock12[1]) % 12;
    const hour = /pm/i.test(clock12[3]) ? hour12 + 12 : hour12;
    const minute = Number(clock12[2]);
    const now = new Date(nowMs);
    let ms = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
      0,
    );
    if (ms <= nowMs) ms += 24 * 60 * 60_000;
    return ms;
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
