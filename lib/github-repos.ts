// Server-only: list the repos the configured GitHub token can access (req-001
// change). Used to populate the add-repo dropdown. Returns a normalized shape;
// the URL matches how the app stores repos (host/owner/repo, no protocol).

export type GithubRepo = {
  fullName: string; // "owner/repo"
  url: string; // "github.com/owner/repo" (normalized, matches store)
};

type RawRepo = { full_name: string; archived?: boolean };

export function mapGithubRepos(raw: RawRepo[]): GithubRepo[] {
  return raw
    .filter((r) => !r.archived)
    .map((r) => ({
      fullName: r.full_name,
      url: `github.com/${r.full_name}`.toLowerCase(),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listGithubRepos(opts?: {
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubRepo[]> {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const doFetch = opts?.fetchImpl ?? fetch;
  if (!token) return [];

  const all: RawRepo[] = [];
  // Paginate; cap at a few pages to stay responsive.
  for (let page = 1; page <= 5; page++) {
    const res = await doFetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) break;
    const batch = (await res.json()) as RawRepo[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return mapGithubRepos(all);
}
