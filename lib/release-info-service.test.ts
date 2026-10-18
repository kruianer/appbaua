import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import type { Repo } from "./repos";
import { readReleaseInfos } from "./release-info-service";
import { releaseInfoContent } from "./release-info";

// req-046 AC7/AC8: die Liste, die appbaua zeigt, bündelt alle Repos nach
// Datum sortiert — jeder Eintrag trägt Repo UND Paket, damit man ihn zuordnen
// kann.

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: "r1",
    name: "appbaua",
    url: "github.com/kruianer/appbaua",
    active: true,
    model: "sonnet",
    monitored: false,
    ...over,
  };
}

function fileFor(repoName: string, packageId: string, iso: string, text: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return releaseInfoContent({
    repoName,
    packageId,
    now: new Date(y, m - 1, d),
    text,
  });
}

/** Stubs the Contents API for exactly one repo, dev-branch only. */
function fetchStubFor(
  ownerRepo: string,
  entries: { name: string; content: string }[],
) {
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    if (!u.pathname.includes(`/repos/${ownerRepo}/`)) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
    const accept = (init?.headers as Record<string, string>)?.Accept ?? "";
    if (accept.includes("raw")) {
      const name = u.pathname.split("/").pop()!;
      const hit = entries.find((e) => e.name === name);
      return hit
        ? { ok: true, status: 200, text: async () => hit.content }
        : { ok: false, status: 404, text: async () => "" };
    }
    if ((u.searchParams.get("ref") ?? "") !== "dev") {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => entries.map((e) => ({ name: e.name, type: "file" })),
    };
  }) as unknown as typeof fetch;
}

function combine(...impls: (typeof fetch)[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    for (const impl of impls) {
      const res = await impl(url, init);
      if (res.ok || (res as { status?: number }).status !== 404) return res;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  setStore(createMemoryStore([]));
});

describe("readReleaseInfos", () => {
  it("AC7: bündelt Einträge mehrerer Repos, neueste zuerst", async () => {
    setStore(
      createMemoryStore([
        repo({ id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua" }),
        repo({ id: "r2", name: "Forschung", url: "github.com/kruianer/forschung" }),
      ]),
    );
    const fetchImpl = combine(
      fetchStubFor("kruianer/appbaua", [
        {
          name: "2026-10-05-req-010.md",
          content: fileFor("appbaua", "req-010", "2026-10-05", "Älter."),
        },
      ]),
      fetchStubFor("kruianer/forschung", [
        {
          name: "2026-10-18-bug-002.md",
          content: fileFor("Forschung", "bug-002", "2026-10-18", "Neuer."),
        },
      ]),
    );

    const entries = await readReleaseInfos({ token: "t", fetchImpl });
    expect(entries.map((e) => e.packageId)).toEqual(["bug-002", "req-010"]);
    expect(entries[0].repoName).toBe("Forschung");
  });

  it("AC8: jeder Eintrag nennt Repo und Paket", async () => {
    setStore(createMemoryStore([repo()]));
    const fetchImpl = fetchStubFor("kruianer/appbaua", [
      {
        name: "2026-10-05-req-010.md",
        content: fileFor("appbaua", "req-010", "2026-10-05", "Text."),
      },
    ]);
    const entries = await readReleaseInfos({ token: "t", fetchImpl });
    expect(entries[0]).toMatchObject({ repoName: "appbaua", packageId: "req-010" });
  });

  it("ein Repo ohne Release-Infos liefert einfach nichts bei", async () => {
    setStore(createMemoryStore([repo()]));
    const fetchImpl = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await readReleaseInfos({ token: "t", fetchImpl })).toEqual([]);
  });

  it("ein fehlerhaftes Repo reißt die Liste der anderen nicht mit", async () => {
    setStore(
      createMemoryStore([
        repo({ id: "r1", name: "Kaputt", url: "github.com/kruianer/kaputt" }),
        repo({ id: "r2", name: "appbaua", url: "github.com/kruianer/appbaua" }),
      ]),
    );
    const throwing = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const fetchImpl = combine(
      ((url: string, init?: RequestInit) => {
        if (String(url).includes("kruianer/kaputt")) return throwing(url, init);
        return fetchStubFor("kruianer/appbaua", [
          {
            name: "2026-10-05-req-010.md",
            content: fileFor("appbaua", "req-010", "2026-10-05", "Text."),
          },
        ])(url, init);
      }) as unknown as typeof fetch,
    );
    const entries = await readReleaseInfos({ token: "t", fetchImpl });
    expect(entries).toHaveLength(1);
    expect(entries[0].repoName).toBe("appbaua");
  });
});
