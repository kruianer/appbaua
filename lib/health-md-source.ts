import type { Repo } from "./repos";
import { githubOwnerRepo } from "./reachability";

// Woher die `delivery/health.md` eines überwachten Repos kommt (req-032).
//
// Der App-Container hat keine Arbeitskopien der fremden Repos — die liegen im
// Worker-Container. Statt dafür ein Volume zu teilen, wird die eine Datei über
// die Contents-API von GitHub gelesen, mit demselben Token, das die App schon
// für die Erreichbarkeitsprüfung hat.
//
// Zuerst auf `dev`: dort landet die Datei, wenn der Nutzer sie über den Skill
// `setup-health` anlegen lässt. Erst wenn das Repo keinen dev-Branch hat, wird
// der Standard-Branch gefragt.

export const HEALTH_MD_PATH = "delivery/health.md";

/** So lange gilt eine einmal gelesene health.md als aktuell. */
export const HEALTH_MD_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { at: number; text: string | null };

const cache = new Map<string, CacheEntry>();

/** Nur für Tests: den Zwischenspeicher leeren. */
export function clearHealthMdCache(): void {
  cache.clear();
}

async function fetchRef(
  ownerRepo: string,
  ref: string | null,
  token: string,
  doFetch: typeof fetch,
): Promise<string | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await doFetch(
    `https://api.github.com/repos/${ownerRepo}/contents/${HEALTH_MD_PATH}${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        // .raw liefert den Dateiinhalt direkt statt base64-verpackt in JSON.
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) return null;
  return res.text();
}

/**
 * Die health.md des Repos, oder null wenn es keine gibt (oder sie nicht
 * gelesen werden kann). Beides führt zum selben Ergebnis: es laufen nur die
 * Prüfungen, die ohne Wissen über die App möglich sind.
 */
export async function fetchHealthMd(
  repo: Repo,
  opts?: { token?: string; fetchImpl?: typeof fetch; nowMs?: number },
): Promise<string | null> {
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const doFetch = opts?.fetchImpl ?? fetch;
  const nowMs = opts?.nowMs ?? Date.now();

  const cached = cache.get(repo.url);
  if (cached && nowMs - cached.at < HEALTH_MD_TTL_MS) return cached.text;

  const ownerRepo = githubOwnerRepo(repo.url);
  if (!ownerRepo || !token) return null;

  let text: string | null = null;
  try {
    text =
      (await fetchRef(ownerRepo, "dev", token, doFetch)) ??
      (await fetchRef(ownerRepo, null, token, doFetch));
  } catch {
    // Netz weg: nicht zwischenspeichern, damit der nächste Lauf es erneut
    // versucht, statt zehn Minuten lang eine erfundene Antwort zu geben.
    return null;
  }

  cache.set(repo.url, { at: nowMs, text });
  return text;
}
