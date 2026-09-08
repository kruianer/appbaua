import { isTransientNetworkError } from "./workspace";

// Network-abort detection for Claude runs (req-038). A run that failed because
// the CONNECTION broke — not because anything is wrong with the package — is
// NOT a real failure: same shape as a rate limit (req-029) or an expired login
// (bug-019), the .md stays in ready/ and the worker pauses briefly before
// trying the queue again. Unlike those two, a network outage ends on its own
// and without a known reset time, so the pause here is short (minutes, not
// hours).
//
// Constraint from bug-020: GitHub calls already retry once on a transient
// network fault (isTransientNetworkError) — but that covers only a single git
// call, not a Claude run that dies mid-response. Both directions are meant to
// get the SAME package-level treatment here, so this reuses that detection
// rather than keeping a second copy of the same wording.
//
// Kept pure and text-only so it is trivially testable and has no I/O.

/** How long to pause after a network abort (req-038) — minutes, not hours. */
export const NETWORK_ABORT_PAUSE_MS = 3 * 60_000; // 3 minutes

/**
 * How many consecutive network aborts the SAME package tolerates before the
 * worker gives up on it (req-038): the 4th one in a row parks it to failed/
 * instead of retrying again — otherwise a package that keeps dying for some
 * other reason could occupy the worker forever behind the guise of "just the
 * network".
 */
export const NETWORK_ABORT_MAX_ATTEMPTS = 3;

/** What the Verlauf leads with for a network-abort pause or give-up. */
export const NETWORK_ABORT_MESSAGE = "Netzabbruch";

/**
 * Phrases a dropped or never-established connection to the KI provider
 * leaves behind. Kept to connection-specific wording on purpose — this must
 * never fire on a Claude-run TIMEOUT (CLAUDE_TIMEOUT_MS), which is a genuine
 * failure and stays one (see isClaudeTimeout below).
 */
const PROVIDER_ABORT_PATTERNS = [
  /connection closed/i,
  /connection reset/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /eai_again/i,
  /socket hang up/i,
  /network error/i,
  /fetch failed/i,
  /getaddrinfo/i,
];

/**
 * Is this a Claude-run TIMEOUT (CLAUDE_TIMEOUT_MS), as opposed to a connection
 * abort? Checked first: a run that hung and got killed after 60 minutes is a
 * different case (it stays a real failure) even if the tail of its last
 * activity happens to mention a network word.
 */
export function isClaudeTimeout(text: string | null | undefined): boolean {
  return !!text && /^Claude-Lauf: Timeout/.test(text);
}

/**
 * Is this failure text a dropped/failed connection rather than a real
 * failure of the package? Covers both directions the constraint calls out: a
 * connection to the KI provider that broke mid-response or never came up, and
 * the GitHub network faults bug-020 already recognises.
 */
export function isNetworkAbort(text: string | null | undefined): boolean {
  if (!text || isClaudeTimeout(text)) return false;
  return PROVIDER_ABORT_PATTERNS.some((re) => re.test(text)) || isTransientNetworkError(text);
}

/** The counter key for one package: scoped by repo, since .md names are not globally unique. */
export function networkAbortKey(repoName: string, md: string): string {
  return `${repoName}::${md}`;
}

/** `counts` with `key` removed (immutable) — used once a package is done or given up on. */
export function withoutKey(
  counts: Record<string, number>,
  key: string,
): Record<string, number> {
  const { [key]: _removed, ...rest } = counts;
  return rest;
}
