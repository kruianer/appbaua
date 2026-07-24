import { normalizeUrl } from "./repos";

// Server-only: check that a (private) repo is reachable with the configured
// GitHub token. req-001 requires a real reachability/permission check, not just
// a format regex. Only GitHub is supported for now (the token is a GitHub PAT);
// other hosts report "not reachable" until support is added.

export type ReachabilityResult =
  | { ok: true }
  | { ok: false; reason: "format" | "unreachable" | "no-token" };

/** Extract "owner/repo" from a normalized github URL, or null. */
export function githubOwnerRepo(normalized: string): string | null {
  const m = normalized.match(/^github\.com\/([^/]+)\/([^/]+)/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

export async function checkReachable(
  rawUrl: string,
  opts?: { token?: string; fetchImpl?: typeof fetch },
): Promise<ReachabilityResult> {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const doFetch = opts?.fetchImpl ?? fetch;

  const normalized = normalizeUrl(rawUrl);
  const ownerRepo = githubOwnerRepo(normalized);
  if (!ownerRepo) return { ok: false, reason: "format" };

  if (!token) return { ok: false, reason: "no-token" };

  try {
    const res = await doFetch(`https://api.github.com/repos/${ownerRepo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.ok) return { ok: true };
    // 404 for private repos the token can't see, 401/403 for bad/insufficient token.
    return { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
