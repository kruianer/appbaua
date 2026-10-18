import type { Repo } from "./repos";
import { githubOwnerRepo } from "./reachability";
import {
  RELEASE_INFO_DIR,
  parseReleaseInfo,
  type ParsedReleaseInfo,
} from "./release-info";

// Woher appbaua die Release-Infos eines Repos liest (req-046). Wie
// health-md-source.ts: der App-Container hat keine Arbeitskopien der fremden
// Repos — die liegen im Worker-Container. Statt dafür ein Volume zu teilen,
// kommt der Ordner über die Contents-API von GitHub, mit demselben Token, das
// die App schon für die Erreichbarkeitsprüfung hat.
//
// Zuerst der dev-Branch: dort committet der Worker die Datei im selben Lauf,
// der das Paket abschließt (execute-step.ts). Erst wenn der Ordner dort
// nachweislich fehlt (404), wird der Standard-Branch gefragt.

export type ReleaseInfoEntry = ParsedReleaseInfo & {
  /** Anzeigename aus der Repo-Liste, nicht aus der Datei — ein umbenanntes
   * Repo zeigt sofort seinen neuen Namen. */
  repoName: string;
};

type DirEntry = { name: string; type: string };

async function listDir(
  ownerRepo: string,
  ref: string | null,
  token: string,
  doFetch: typeof fetch,
): Promise<DirEntry[] | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await doFetch(
    `https://api.github.com/repos/${ownerRepo}/contents/${RELEASE_INFO_DIR}${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  // 404 heißt: diesen Ordner gibt es auf diesem Ref wirklich nicht — ein
  // Repo, das noch kein Paket abgeschlossen hat, oder (beim dev-Versuch)
  // eines ohne dev-Branch.
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? body : null;
}

async function readFile(
  ownerRepo: string,
  ref: string | null,
  path: string,
  token: string,
  doFetch: typeof fetch,
): Promise<string | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await doFetch(
    `https://api.github.com/repos/${ownerRepo}/contents/${path}${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        // .raw liefert den Dateiinhalt direkt statt base64 in JSON.
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) return null;
  return res.text();
}

/**
 * All release infos a repo has filed, or [] when it has none (yet), the repo
 * is not on GitHub, or there is no token. Best effort throughout: a repo this
 * cannot be read from must not break the aggregate list for the others.
 */
export async function fetchReleaseInfos(
  repo: Repo,
  opts?: { token?: string; fetchImpl?: typeof fetch },
): Promise<ReleaseInfoEntry[]> {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const doFetch = opts?.fetchImpl ?? fetch;
  const ownerRepo = githubOwnerRepo(repo.url);
  if (!ownerRepo || !token) return [];

  let ref: string | null = "dev";
  let dirEntries: DirEntry[] | null;
  try {
    dirEntries = await listDir(ownerRepo, ref, token, doFetch);
    if (dirEntries === null) {
      ref = null;
      dirEntries = await listDir(ownerRepo, null, token, doFetch);
    }
  } catch {
    return [];
  }
  if (!dirEntries) return [];

  const files = dirEntries.filter(
    (e) => e.type === "file" && e.name.toLowerCase().endsWith(".md"),
  );
  const parsed = await Promise.all(
    files.map(async (f) => {
      const raw = await readFile(
        ownerRepo,
        ref,
        `${RELEASE_INFO_DIR}/${f.name}`,
        token,
        doFetch,
      ).catch(() => null);
      if (!raw) return null;
      const info = parseReleaseInfo(raw);
      return info ? { ...info, repoName: repo.name } : null;
    }),
  );
  return parsed.filter((e): e is ReleaseInfoEntry => e !== null);
}
