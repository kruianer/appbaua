import { describe, it, expect } from "vitest";
import type { Repo } from "./repos";
import { fetchReleaseInfos } from "./release-info-source";
import { releaseInfoContent } from "./release-info";

// req-046: woher appbaua die Release-Infos eines Repos liest. Der
// App-Container hat keine Arbeitskopien der fremden Repos, also kommt der
// Ordner über die Contents-API von GitHub — wie health-md-source.ts.

const repo: Repo = {
  id: "r1",
  name: "appbaua",
  url: "github.com/kruianer/appbaua",
  active: true,
  model: "sonnet",
  monitored: false,
};

const FILE_A = releaseInfoContent({
  repoName: "appbaua",
  packageId: "req-044-wochenbudget-je-repo",
  now: new Date(2026, 9, 10),
  text: "Du kannst jetzt je Repo ein Wochenbudget setzen.",
});
const FILE_B = releaseInfoContent({
  repoName: "appbaua",
  packageId: "req-043-feedback-als-task-art",
  now: new Date(2026, 9, 5),
  text: "Feedback wird jetzt als eigener Task-Typ bearbeitet.",
});

function stub(opts: {
  dirByRef?: Record<string, { name: string; type: string }[] | null>;
  files?: Record<string, string>;
}) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const u = new URL(String(url));
    const ref = u.searchParams.get("ref") ?? "";
    const accept = (init?.headers as Record<string, string>)?.Accept ?? "";
    if (accept.includes("raw")) {
      const path = decodeURIComponent(
        u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ""),
      );
      const body = opts.files?.[path];
      return body === undefined
        ? { ok: false, status: 404, text: async () => "" }
        : { ok: true, status: 200, text: async () => body };
    }
    const dir = opts.dirByRef?.[ref];
    return dir === undefined || dir === null
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => dir };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("fetchReleaseInfos", () => {
  it("liest den Ordner vom dev-Branch und parst jede Datei", async () => {
    const { fetchImpl } = stub({
      dirByRef: {
        dev: [
          { name: "2026-10-10-req-044-wochenbudget-je-repo.md", type: "file" },
          { name: "2026-10-05-req-043-feedback-als-task-art.md", type: "file" },
        ],
      },
      files: {
        "delivery/release-info/2026-10-10-req-044-wochenbudget-je-repo.md": FILE_A,
        "delivery/release-info/2026-10-05-req-043-feedback-als-task-art.md": FILE_B,
      },
    });
    const entries = await fetchReleaseInfos(repo, { token: "t", fetchImpl });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.packageId)).toEqual(
      expect.arrayContaining([
        "req-044-wochenbudget-je-repo",
        "req-043-feedback-als-task-art",
      ]),
    );
  });

  it("nimmt den Anzeigenamen aus der Repo-Liste, nicht aus der Datei", async () => {
    const { fetchImpl } = stub({
      dirByRef: { dev: [{ name: "2026-10-10-x.md", type: "file" }] },
      files: { "delivery/release-info/2026-10-10-x.md": FILE_A },
    });
    const entries = await fetchReleaseInfos(
      { ...repo, name: "Umbenannt" },
      { token: "t", fetchImpl },
    );
    expect(entries[0].repoName).toBe("Umbenannt");
  });

  it("fällt auf den Standard-Branch zurück, wenn es keinen dev-Ordner gibt", async () => {
    const { fetchImpl, calls } = stub({
      dirByRef: {
        dev: null,
        "": [{ name: "2026-10-05-req-043-feedback-als-task-art.md", type: "file" }],
      },
      files: {
        "delivery/release-info/2026-10-05-req-043-feedback-als-task-art.md": FILE_B,
      },
    });
    const entries = await fetchReleaseInfos(repo, { token: "t", fetchImpl });
    expect(entries).toHaveLength(1);
    expect(calls.some((u) => u.includes("ref=dev"))).toBe(true);
  });

  it("gibt [] zurück, wenn es den Ordner gar nicht gibt", async () => {
    const { fetchImpl } = stub({ dirByRef: { dev: null, "": null } });
    expect(await fetchReleaseInfos(repo, { token: "t", fetchImpl })).toEqual([]);
  });

  it("ignoriert Dateien, die sich nicht parsen lassen, statt zu brechen", async () => {
    const { fetchImpl } = stub({
      dirByRef: {
        dev: [
          { name: "2026-10-10-kaputt.md", type: "file" },
          { name: "2026-10-05-ok.md", type: "file" },
        ],
      },
      files: {
        "delivery/release-info/2026-10-10-kaputt.md": "kein frontmatter hier",
        "delivery/release-info/2026-10-05-ok.md": FILE_B,
      },
    });
    const entries = await fetchReleaseInfos(repo, { token: "t", fetchImpl });
    expect(entries).toHaveLength(1);
    expect(entries[0].packageId).toBe("req-043-feedback-als-task-art");
  });

  it("ohne Token wird gar nicht erst gefragt", async () => {
    const { fetchImpl, calls } = stub({ dirByRef: { dev: [] } });
    expect(await fetchReleaseInfos(repo, { token: "", fetchImpl })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("ein Repo auf einem anderen Host als GitHub liefert []", async () => {
    const { fetchImpl } = stub({ dirByRef: { dev: [] } });
    expect(
      await fetchReleaseInfos(
        { ...repo, url: "gitlab.com/kruianer/appbaua" },
        { token: "t", fetchImpl },
      ),
    ).toEqual([]);
  });

  it("ein Netzfehler liefert [] statt zu werfen", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fetchReleaseInfos(repo, { token: "t", fetchImpl })).toEqual([]);
  });
});
