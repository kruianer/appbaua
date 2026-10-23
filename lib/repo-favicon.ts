// Server-only (req-050): das Favicon eines Repos, wie es im Code auf `main`
// liegt — nicht das der laufenden App und nicht das von `dev`. Gelesen über
// die GitHub-Contents-API; das Ergebnis (auch "keins") wird einen Tag
// gemerkt, damit der Chat nicht bei jedem Öffnen GitHub befragt.

export type Favicon = { contentType: string; data: Buffer };

/** Orte, an denen ein Next.js-/statisches Projekt sein Favicon ablegt — in dieser Reihenfolge. */
export const FAVICON_PATHS = [
  "app/favicon.ico",
  "src/app/favicon.ico",
  "app/icon.svg",
  "app/icon.png",
  "src/app/icon.svg",
  "src/app/icon.png",
  "public/favicon.ico",
  "public/favicon.svg",
  "public/favicon.png",
  "static/favicon.ico",
  "favicon.ico",
  "favicon.svg",
  "favicon.png",
];

/** Wie lange ein Ergebnis gilt: spätestens am Folgetag zeigt der Chat das neue Favicon. */
export const FAVICON_TTL_MS = 24 * 60 * 60 * 1000;

/** Erkennt das Bildformat an den ersten Bytes; null = kein lesbares Bild. */
export function sniffImageType(data: Buffer): string | null {
  if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0) {
    return "image/x-icon";
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6 && /^GIF8[79]a/.test(data.subarray(0, 6).toString("latin1"))) {
    return "image/gif";
  }
  const head = data.subarray(0, 1024).toString("utf8");
  if (/<svg[\s>]/i.test(head)) {
    return "image/svg+xml";
  }
  return null;
}

/** "github.com/owner/repo" → "owner/repo"; null bei anderen Hosts. */
export function githubFullName(url: string): string | null {
  const m = /^github\.com\/([^/]+\/[^/]+)$/i.exec(url.replace(/\.git$/, ""));
  return m ? m[1] : null;
}

export async function fetchFaviconFromMain(
  url: string,
  opts?: { token?: string; fetchImpl?: typeof fetch },
): Promise<Favicon | null> {
  const fullName = githubFullName(url);
  const token = opts?.token ?? process.env.GITHUB_TOKEN;
  const doFetch = opts?.fetchImpl ?? fetch;
  if (!fullName) return null;
  for (const path of FAVICON_PATHS) {
    try {
      const res = await doFetch(
        `https://api.github.com/repos/${fullName}/contents/${path}?ref=main`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/vnd.github.raw+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      const contentType = sniffImageType(data);
      // Eine kaputte Datei zählt nicht als Favicon — weiter zum Platzhalter
      // statt zu einem Bild, das der Browser nicht darstellen kann.
      if (contentType) return { contentType, data };
    } catch {
      // nächster Pfad
    }
  }
  return null;
}

const cache = new Map<string, { at: number; value: Favicon | null }>();

export async function getRepoFavicon(
  url: string,
  opts?: { now?: number; token?: string; fetchImpl?: typeof fetch },
): Promise<Favicon | null> {
  const now = opts?.now ?? Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < FAVICON_TTL_MS) return hit.value;
  const value = await fetchFaviconFromMain(url, opts);
  cache.set(url, { at: now, value });
  return value;
}

export function clearFaviconCache(): void {
  cache.clear();
}
