import { describe, it, expect, beforeEach } from "vitest";
import type { Repo } from "./repos";
import { clearHealthMdCache, fetchHealthMd, HEALTH_MD_TTL_MS } from "./health-md-source";

// req-032: woher die health.md eines überwachten Repos kommt. Der
// App-Container hat keine Arbeitskopien der fremden Repos, also wird die eine
// Datei über die Contents-API von GitHub gelesen.

const repo: Repo = {
  id: "r1",
  name: "LivingGardenTwin",
  url: "github.com/kruianer/livinggardentwin",
  active: true,
  model: "sonnet",
  monitored: true,
};

function stub(byRef: Record<string, string | null>) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const ref = new URL(String(url)).searchParams.get("ref") ?? "";
    const body = byRef[ref];
    return body === undefined || body === null
      ? { ok: false, status: 404, text: async () => "" }
      : { ok: true, status: 200, text: async () => body };
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

beforeEach(() => {
  clearHealthMdCache();
});

describe("fetchHealthMd", () => {
  it("liest zuerst den dev-Branch — dort legt setup-health die Datei an", async () => {
    const { fetchImpl, urls } = stub({ dev: "# Health-Checks\n" });
    expect(await fetchHealthMd(repo, { token: "t", fetchImpl })).toBe("# Health-Checks\n");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(
      "repos/kruianer/livinggardentwin/contents/delivery/health.md?ref=dev",
    );
  });

  it("fällt auf den Standard-Branch zurück, wenn es kein dev gibt", async () => {
    const { fetchImpl, urls } = stub({ dev: null, "": "# vom main\n" });
    expect(await fetchHealthMd(repo, { token: "t", fetchImpl })).toBe("# vom main\n");
    expect(urls).toHaveLength(2);
  });

  it("gibt null zurück, wenn das Repo keine health.md hat", async () => {
    const { fetchImpl } = stub({});
    expect(await fetchHealthMd(repo, { token: "t", fetchImpl })).toBeNull();
  });

  it("ohne Token wird gar nicht erst gefragt", async () => {
    const { fetchImpl, urls } = stub({ dev: "x" });
    expect(await fetchHealthMd(repo, { token: "", fetchImpl })).toBeNull();
    expect(urls).toEqual([]);
  });

  it("merkt sich die Antwort für die nächsten Prüfrunden", async () => {
    const { fetchImpl, urls } = stub({ dev: "# Health-Checks\n" });
    await fetchHealthMd(repo, { token: "t", fetchImpl, nowMs: 0 });
    await fetchHealthMd(repo, { token: "t", fetchImpl, nowMs: 1000 });
    expect(urls).toHaveLength(1);
  });

  it("fragt nach Ablauf der Frist erneut — eine neue health.md wirkt", async () => {
    const { fetchImpl, urls } = stub({ dev: "# Health-Checks\n" });
    await fetchHealthMd(repo, { token: "t", fetchImpl, nowMs: 0 });
    await fetchHealthMd(repo, { token: "t", fetchImpl, nowMs: HEALTH_MD_TTL_MS + 1 });
    expect(urls).toHaveLength(2);
  });

  it("merkt sich einen Netzfehler NICHT als Antwort", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fetchHealthMd(repo, { token: "t", fetchImpl, nowMs: 0 })).toBeNull();
    expect(await fetchHealthMd(repo, { token: "t", fetchImpl, nowMs: 1 })).toBeNull();
    expect(calls).toBe(2);
  });
});
