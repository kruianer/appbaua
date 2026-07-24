import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore, getStore } from "./store";
import {
  addRepo,
  listRepos,
  removeRepo,
  reorderRepos,
  toggleRepo,
} from "./repo-service";
import type { ReachabilityResult } from "./reachability";

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
