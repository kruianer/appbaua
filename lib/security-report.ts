// Everything the Security task needs to be a task type of its own (req-014).
// Pure string logic — no git, no fs — so both the folder convention and the
// "was there a finding?" decision are unit-testable on their own.
//
// Why its own module next to review-report: a Security run files its report in
// its own folder, and unlike a Code-Review it files NOTHING when it found
// nothing. That "nothing found" is a fact the worker has to read off Claude's
// answer, because — other than with the Ideen task (req-011) — there is no
// folder whose before/after would tell it.

/** Fixed folder in the target repo that collects the security reports. */
export const SECURITY_REPORT_DIR = "delivery/security";

/**
 * The repo's optional security policy: what the operator wants (reachability,
 * HTTPS, who may access, backup expectation). The user maintains it via the
 * setup-security skill; the worker only reads it, and falls back to general
 * best practices when it is missing.
 */
export const SECURITY_POLICY_FILE = "delivery/security.md";

/**
 * What the worker logs — and what Claude is asked to answer — when a check
 * found nothing worth reporting. A run that says this files no report file.
 */
export const SECURITY_OK_MESSAGE = "Security-Check ok";

/** Letters and digits only, lowercase, single-spaced — markdown decoration
 * ("**Security-Check ok.**") must not change what an answer means. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Did the check produce at least one finding? Everything except the agreed
 * all-clear answer counts as one — a report is only filed when there is
 * something to read, and an empty answer is nothing to read (req-014).
 */
export function hasSecurityFindings(report: string): boolean {
  const body = normalize(report);
  if (!body) return false;
  return body !== normalize(SECURITY_OK_MESSAGE);
}
