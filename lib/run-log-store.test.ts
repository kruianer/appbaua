import { describe, it, expect } from "vitest";
import { applyRetention, createMemoryRunLogStore } from "./run-log-store";
import type { RunLogEntry } from "./run-log";

function entry(id: number, daysAgo: number): RunLogEntry {
  const t = new Date(2026, 6, 24, 12, 0, 0);
  t.setDate(t.getDate() - daysAgo);
  return {
    id,
    startedAt: t.toISOString(),
    endedAt: t.toISOString(),
    repo: "appbaua",
    taskType: "Bugs",
    status: "success",
    message: "",
  };
}

describe("applyRetention", () => {
  const now = new Date(2026, 6, 24, 12, 0, 0);

  it("drops entries older than the age limit", () => {
    const kept = applyRetention([entry(1, 400), entry(2, 10)], now);
    expect(kept.map((e) => e.id)).toEqual([2]);
  });

  it("keeps only the newest maxRows (oldest dropped first)", () => {
    const rows = [entry(1, 3), entry(2, 2), entry(3, 1)]; // oldest-first
    const kept = applyRetention(rows, now, 2);
    expect(kept.map((e) => e.id)).toEqual([2, 3]);
  });
});

describe("upsertIdle (req-021)", () => {
  const idle = (min: number) => ({
    startedAt: new Date(2026, 6, 24, 12, 0).toISOString(),
    endedAt: new Date(2026, 6, 24, 12, min).toISOString(),
    repo: null,
    taskType: null,
    status: "idle" as const,
    message: `checked at 12:${min}`,
    md: null,
  });

  it("collapses consecutive idle passes into one growing row", async () => {
    const store = createMemoryRunLogStore();
    await store.upsertIdle(idle(0));
    await store.upsertIdle(idle(5));
    await store.upsertIdle(idle(10));
    expect(await store.count()).toBe(1); // one row, not three
    const [row] = await store.list(0, 1);
    expect(row.startedAt).toBe(idle(0).startedAt); // start kept ("seit")
    expect(row.endedAt).toBe(idle(10).endedAt); // last-checked moved forward
    expect(row.message).toBe("checked at 12:10");
  });

  it("real work between idle passes breaks the summary — a new one starts", async () => {
    const store = createMemoryRunLogStore();
    await store.upsertIdle(idle(0));
    await store.append({
      startedAt: new Date(2026, 6, 24, 12, 2).toISOString(),
      endedAt: new Date(2026, 6, 24, 12, 2).toISOString(),
      repo: "appbaua",
      taskType: "Bugs",
      status: "success",
      message: "done",
    });
    await store.upsertIdle(idle(5));
    expect(await store.count()).toBe(3); // idle, work, NEW idle
    const rows = await store.list(0, 3);
    expect(rows[0].status).toBe("idle"); // newest is the fresh idle summary
    expect(rows[1].status).toBe("success");
  });
});

describe("memory run-log store", () => {
  it("lists newest first and paginates", async () => {
    const store = createMemoryRunLogStore();
    for (let i = 0; i < 5; i++) {
      await store.append({
        startedAt: new Date(2026, 6, 24, 12, i).toISOString(),
        endedAt: new Date(2026, 6, 24, 12, i).toISOString(),
        repo: "appbaua",
        taskType: "Bugs",
        status: "success",
        message: `m${i}`,
      });
    }
    expect(await store.count()).toBe(5);
    const page0 = await store.list(0, 2);
    expect(page0.map((e) => e.message)).toEqual(["m4", "m3"]); // newest first
    const page1 = await store.list(2, 2);
    expect(page1.map((e) => e.message)).toEqual(["m2", "m1"]);
  });

  it("metricsSince counts completed steps and errors after a cutoff", async () => {
    const store = createMemoryRunLogStore();
    const mk = (h: number, status: "success" | "error" | "idle") => ({
      startedAt: new Date(2026, 6, 24, h, 0).toISOString(),
      endedAt: new Date(2026, 6, 24, h, 0).toISOString(),
      repo: "appbaua",
      taskType: "Bugs",
      status,
      message: "",
    });
    await store.append(mk(8, "success")); // before cutoff
    await store.append(mk(11, "success"));
    await store.append(mk(12, "error"));
    await store.append(mk(13, "idle")); // idle not counted
    const since = new Date(2026, 6, 24, 10, 0).toISOString();
    expect(await store.metricsSince(since)).toEqual({ done: 2, errors: 1 });
  });

  it("clear removes every entry (req-007)", async () => {
    const store = createMemoryRunLogStore();
    for (let i = 0; i < 5; i++) {
      await store.append({
        startedAt: new Date(2026, 6, 24, 12, i).toISOString(),
        endedAt: new Date(2026, 6, 24, 12, i).toISOString(),
        repo: "appbaua",
        taskType: "Bugs",
        status: i === 0 ? "error" : "success",
        message: `m${i}`,
      });
    }
    expect(await store.count()).toBe(5);

    await store.clear();

    expect(await store.count()).toBe(0);
    expect(await store.list(0, 50)).toEqual([]);
    expect(await store.lastError()).toBeNull();
  });

  it("stays usable after clear — new entries are logged again", async () => {
    const store = createMemoryRunLogStore();
    await store.append({
      startedAt: new Date(2026, 6, 24, 12, 0).toISOString(),
      endedAt: new Date(2026, 6, 24, 12, 0).toISOString(),
      repo: "appbaua",
      taskType: "Bugs",
      status: "success",
      message: "alt",
    });
    await store.clear();
    await store.append({
      startedAt: new Date(2026, 6, 24, 12, 5).toISOString(),
      endedAt: new Date(2026, 6, 24, 12, 5).toISOString(),
      repo: "appbaua",
      taskType: "Bugs",
      status: "success",
      message: "neu",
    });
    expect(await store.count()).toBe(1);
    expect((await store.list(0, 10)).map((e) => e.message)).toEqual(["neu"]);
  });

  it("lastError returns the most recent error or null", async () => {
    const store = createMemoryRunLogStore();
    expect(await store.lastError()).toBeNull();
    await store.append({
      startedAt: new Date(2026, 6, 24, 11).toISOString(),
      endedAt: new Date(2026, 6, 24, 11).toISOString(),
      repo: "appbaua",
      taskType: "Bugs",
      status: "error",
      message: "boom",
    });
    const e = await store.lastError();
    expect(e?.message).toBe("boom");
  });
});
