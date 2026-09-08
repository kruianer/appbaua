import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMemoryStore, setStore, getStore } from "./store";
import {
  addRepo,
  convertRepoToAppbaua,
  listRepos,
  removeRepo,
  reorderRepos,
  setRepoModel,
  toggleRepo,
  toggleRepoMonitored,
} from "./repo-service";
import type { ReachabilityResult } from "./reachability";
import type { ConvertResult } from "./appbaua-standard";

const reachable = () => Promise.resolve({ ok: true } as ReachabilityResult);
const unreachable = () =>
  Promise.resolve({ ok: false, reason: "unreachable" } as ReachabilityResult);

beforeEach(() => {
  setStore(createMemoryStore());
});

// Each test maps to an acceptance criterion in req-001.

describe("req-001 acceptance criteria", () => {
  it("AC: empty list — a fresh install has no repos", async () => {
    expect(await listRepos()).toEqual([]);
  });

  it("AC: adding a reachable repo without a name derives 'appbaua'", async () => {
    const res = await addRepo(
      { url: "https://github.com/kruianer/appbaua.git" },
      { checkReachable: reachable },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repo.name).toBe("appbaua");
      expect(res.repo.url).toBe("github.com/kruianer/appbaua");
      expect(res.repo.active).toBe(true);
    }
  });

  it("req-028: a newly added repo defaults to sonnet", async () => {
    const res = await addRepo(
      { url: "https://github.com/kruianer/appbaua.git" },
      { checkReachable: reachable },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.repo.model).toBe("sonnet");
  });

  it("AC: a repo with no access is rejected as unreachable", async () => {
    const res = await addRepo(
      { url: "github.com/kruianer/secret" },
      { checkReachable: unreachable },
    );
    expect(res).toEqual({ ok: false, error: "unreachable" });
    expect(await listRepos()).toHaveLength(0);
  });

  it("AC: the same url cannot be added twice", async () => {
    await addRepo(
      { url: "https://github.com/kruianer/appbaua.git" },
      { checkReachable: reachable },
    );
    const dup = await addRepo(
      { url: "http://github.com/kruianer/appbaua" },
      { checkReachable: reachable },
    );
    expect(dup).toEqual({ ok: false, error: "duplicate" });
    expect(await listRepos()).toHaveLength(1);
  });

  it("AC: reordering moves a repo to position 1 and persists", async () => {
    await addRepo(
      { url: "github.com/kruianer/appbaua", name: "appbaua" },
      { checkReachable: reachable },
    );
    await addRepo(
      { url: "github.com/kruianer/worker", name: "worker" },
      { checkReachable: reachable },
    );
    const before = await listRepos();
    expect(before.map((r) => r.name)).toEqual(["appbaua", "worker"]);

    const workerId = before.find((r) => r.name === "worker")!.id;
    const appbauaId = before.find((r) => r.name === "appbaua")!.id;
    await reorderRepos([workerId, appbauaId]);

    // re-read from the store — proves persistence, not just in-memory return
    const after = await getStore().list();
    expect(after.map((r) => r.name)).toEqual(["worker", "appbaua"]);
  });

  it("AC: toggling inactive keeps the repo in its position", async () => {
    await addRepo(
      { url: "github.com/kruianer/appbaua", name: "appbaua" },
      { checkReachable: reachable },
    );
    await addRepo(
      { url: "github.com/kruianer/worker", name: "worker" },
      { checkReachable: reachable },
    );
    const list = await listRepos();
    const appbaua = list[0];
    const after = await toggleRepo(appbaua.id);
    expect(after[0].id).toBe(appbaua.id); // still position 1
    expect(after[0].active).toBe(false); // now inactive
  });

  it("req-032: a newly added repo is NOT watched — that is switched on deliberately", async () => {
    const res = await addRepo(
      { url: "github.com/kruianer/appbaua" },
      { checkReachable: reachable },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.repo.monitored).toBe(false);
  });

  it("req-032: 'überwachen' and 'aktiv' are independent switches", async () => {
    await addRepo(
      { url: "github.com/kruianer/livinggardentwin", name: "LivingGardenTwin" },
      { checkReachable: reachable },
    );
    const [lgt] = await listRepos();

    // Watched, but the worker is not to touch it.
    await toggleRepoMonitored(lgt.id);
    const afterMonitor = await toggleRepo(lgt.id);
    expect(afterMonitor[0].monitored).toBe(true);
    expect(afterMonitor[0].active).toBe(false);

    // And back off again, without touching `active`.
    const afterOff = await toggleRepoMonitored(lgt.id);
    expect(afterOff[0].monitored).toBe(false);
    expect(afterOff[0].active).toBe(false);
  });

  it("req-028: setting a repo's model persists it and leaves other repos alone", async () => {
    await addRepo(
      { url: "github.com/kruianer/appbaua", name: "appbaua" },
      { checkReachable: reachable },
    );
    await addRepo(
      { url: "github.com/kruianer/livinggardenkeeper", name: "livinggardenkeeper" },
      { checkReachable: reachable },
    );
    const [appbaua, keeper] = await listRepos();
    await setRepoModel(keeper.id, "opus");

    const after = await getStore().list(); // re-read: proves persistence
    expect(after.find((r) => r.id === keeper.id)?.model).toBe("opus");
    expect(after.find((r) => r.id === appbaua.id)?.model).toBe("sonnet");
  });

  it("AC: removing a repo deletes exactly that repo", async () => {
    await addRepo(
      { url: "github.com/kruianer/appbaua", name: "appbaua" },
      { checkReachable: reachable },
    );
    await addRepo(
      { url: "github.com/kruianer/worker", name: "worker" },
      { checkReachable: reachable },
    );
    const list = await listRepos();
    const appbaua = list.find((r) => r.name === "appbaua")!;
    const after = await removeRepo(appbaua.id);
    expect(after.map((r) => r.name)).toEqual(["worker"]);
  });

  it("rejects an empty url", async () => {
    const res = await addRepo({ url: "  " }, { checkReachable: reachable });
    expect(res).toEqual({ ok: false, error: "empty" });
  });
});

// req-012: the repo list's "Auf appbaua umstellen" action. The rollout itself is
// covered in appbaua-standard.test.ts; here it is only about which repo the
// action addresses and how its outcome reaches the caller.
describe("convertRepoToAppbaua (req-012)", () => {
  const summary = {
    skills: 6,
    folders: 5,
    foldersCreated: 5,
    siteFolders: 3,
    siteFoldersCreated: 3,
    claudeMd: "angelegt" as const,
    branch: "dev",
    pushDetail: "auf dev gepusht",
  };

  async function seedRepo(name: string): Promise<string> {
    const res = await addRepo(
      { url: `github.com/kruianer/${name}`, name },
      { checkReachable: reachable },
    );
    if (!res.ok) throw new Error(res.error);
    return res.repo.id;
  }

  it("rollt den Standard in genau das geklickte Repo aus", async () => {
    await seedRepo("appbaua");
    const id = await seedRepo("leer-repo");
    const seen: string[] = [];

    const res = await convertRepoToAppbaua(id, {
      rollOut: async (url) => {
        seen.push(url);
        return { ok: true, summary, message: "6 Skills kopiert" };
      },
    });

    expect(seen).toEqual(["github.com/kruianer/leer-repo"]);
    expect(res).toEqual({ ok: true, message: "6 Skills kopiert", summary });
  });

  it("eine unbekannte id ist ein 'nicht gefunden' und rollt nichts aus", async () => {
    const rollOut = vi.fn(
      async (): Promise<ConvertResult> => ({ ok: true, summary, message: "x" }),
    );

    const res = await convertRepoToAppbaua("gibt-es-nicht", { rollOut });

    expect(res).toEqual({
      ok: false,
      error: "Repo nicht gefunden.",
      notFound: true,
    });
    expect(rollOut).not.toHaveBeenCalled();
  });

  it("gibt den Fehler der Umstellung unverändert weiter", async () => {
    const id = await seedRepo("leer-repo");

    const res = await convertRepoToAppbaua(id, {
      rollOut: async () => ({ ok: false, error: "Nichts gepusht — keine Rechte" }),
    });

    expect(res).toEqual({ ok: false, error: "Nichts gepusht — keine Rechte" });
  });
});
