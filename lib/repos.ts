// Domain type + pure helpers for the repo list. No I/O here so these are
// trivially unit-testable and shared between server and tests.

/**
 * The Claude models a repo can be worked with (req-028), each the current (5)
 * version. `sonnet` is the default — easy on rate limits; `opus` is picked
 * deliberately per repo where the extra depth is worth it (e.g. hardware work).
 */
export const REPO_MODELS = ["fable", "sonnet", "opus", "haiku"] as const;
export type RepoModel = (typeof REPO_MODELS)[number];
export const DEFAULT_REPO_MODEL: RepoModel = "sonnet";

/** Display label for a model option, for the repo list's picker. */
export const REPO_MODEL_LABELS: Record<RepoModel, string> = {
  fable: "Fable 5",
  sonnet: "Sonnet 5",
  opus: "Opus 5",
  haiku: "Haiku",
};

export type Repo = {
  id: string;
  name: string;
  /** Normalized git URL, protocol stripped, no trailing slash. Unique key. */
  url: string;
  active: boolean;
  /**
   * Model the worker uses for this repo's Claude Code calls (req-028). Persists
   * until changed; a new run picks it up, a running step finishes with its own.
   */
  model: RepoModel;
};

/**
 * Normalize a git URL for storage and duplicate detection: strip protocol and
 * a trailing ".git"/slashes, lowercase the host+path. Two inputs that point at
 * the same repo normalize to the same string.
 *   https://github.com/kruianer/appbaua.git -> github.com/kruianer/appbaua
 */
export function normalizeUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^git@([^:]+):/i, "$1/") // git@github.com:owner/repo -> github.com/owner/repo
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Basic shape check: host/owner/repo on a known git host. */
export function looksLikeRepoUrl(raw: string): boolean {
  return /^(https?:\/\/)?(www\.)?(github|gitlab|bitbucket)\.[a-z.]+\/[^/]+\/[^/]+/i.test(
    raw.trim(),
  );
}

/** Display name when none was given: last path segment of the URL. */
export function deriveName(normalizedUrl: string): string {
  const seg = normalizedUrl.split("/").filter(Boolean).pop();
  return seg || normalizedUrl;
}

export function isDuplicate(repos: Repo[], normalizedUrl: string): boolean {
  return repos.some((r) => r.url === normalizedUrl);
}
