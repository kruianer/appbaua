import { beforeEach, describe, expect, it } from "vitest";
import {
  FAVICON_TTL_MS,
  clearFaviconCache,
  getRepoFavicon,
  githubFullName,
  sniffImageType,
} from "./repo-favicon";

const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function fakeFetch(files: Record<string, Buffer>, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    const m = /contents\/(.+)\?ref=(\w+)$/.exec(url);
    const f = m && m[2] === "main" ? files[m[1]] : undefined;
    if (!f) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(f).buffer };
  }) as unknown as typeof fetch;
}

beforeEach(() => clearFaviconCache());

describe("req-050 Favicon von main", () => {
  it("erkennt Bildformate und lehnt Unbrauchbares ab", () => {
    expect(sniffImageType(ICO)).toBe("image/x-icon");
    expect(sniffImageType(SVG)).toBe("image/svg+xml");
    expect(sniffImageType(Buffer.from("das ist kein Bild"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it("liest nur github.com-URLs", () => {
    expect(githubFullName("github.com/k/cellarvoice")).toBe("k/cellarvoice");
    expect(githubFullName("gitlab.com/k/x")).toBeNull();
  });

  it("liefert das Favicon von main", async () => {
    const calls: string[] = [];
    const icon = await getRepoFavicon("github.com/k/cv", {
      token: "t",
      fetchImpl: fakeFetch({ "app/favicon.ico": ICO }, calls),
    });
    expect(icon?.contentType).toBe("image/x-icon");
    expect(calls.every((c) => c.endsWith("?ref=main"))).toBe(true);
  });

  it("ein Favicon nur auf dev zählt nicht", async () => {
    // fakeFetch kennt nur main; Dateien auf dev sind für ihn unsichtbar.
    const icon = await getRepoFavicon("github.com/k/cv", {
      token: "t",
      fetchImpl: fakeFetch({}),
    });
    expect(icon).toBeNull();
  });

  it("eine kaputte Datei ergibt kein Favicon", async () => {
    const icon = await getRepoFavicon("github.com/k/cv", {
      token: "t",
      fetchImpl: fakeFetch({ "app/favicon.ico": Buffer.from("kaputt") }),
    });
    expect(icon).toBeNull();
  });

  it("merkt sich das Ergebnis einen Tag, danach wird neu gelesen", async () => {
    const calls: string[] = [];
    const f = fakeFetch({ "app/favicon.ico": ICO }, calls);
    await getRepoFavicon("github.com/k/cv", { now: 0, token: "t", fetchImpl: f });
    const n = calls.length;
    await getRepoFavicon("github.com/k/cv", { now: FAVICON_TTL_MS - 1, token: "t", fetchImpl: f });
    expect(calls.length).toBe(n);
    await getRepoFavicon("github.com/k/cv", { now: FAVICON_TTL_MS + 1, token: "t", fetchImpl: f });
    expect(calls.length).toBe(n + 1);
  });
});
