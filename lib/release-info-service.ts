import { listRepos } from "./repo-service";
import { fetchReleaseInfos, type ReleaseInfoEntry } from "./release-info-source";

// req-046: die aggregierte Liste, die appbaua anzeigt — alle Repos, neueste
// Release-Info zuerst.

/**
 * Alle Release-Infos aller Repos, neueste zuerst (AC7). Ein Repo, das nicht
 * gelesen werden konnte, liefert einfach nichts bei — es darf die Liste der
 * anderen nicht mitreißen.
 */
export async function readReleaseInfos(
  deps?: { token?: string; fetchImpl?: typeof fetch },
): Promise<ReleaseInfoEntry[]> {
  const repos = await listRepos();
  const perRepo = await Promise.all(
    repos.map((r) => fetchReleaseInfos(r, deps).catch(() => [])),
  );
  return perRepo.flat().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
