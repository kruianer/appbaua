import { describe, it, expect, vi } from "vitest";
import { buildPreview, type PreviewDeps } from "./preview";
import { defaultTaskTypes, emptySchedule, type TaskType } from "./task-types";
import type { Repo } from "./repos";

const WED_18 = new Date(2026, 6, 22, 18, 0, 0);

const repo = (over: Partial<Repo> = {}): Repo => ({
  id: "r1",
  name: "appbaua",
  url: "github.com/kruianer/appbaua",
  active: true,
  model: "sonnet",
  monitored: false,
  ...over,
});

function deps(over: Partial<PreviewDeps> = {}): PreviewDeps {
  return {
    prepareRepo: vi.fn(async () => ({ dir: "/work/appbaua" })),
    listReady: vi.fn(async () => []),
    ...over,
  };
}

describe("buildPreview (req-022)", () => {
  it("AC: a file-driven type with a waiting file shows its name", async () => {
    const [bug] = defaultTaskTypes();
    const d = deps({
      listReady: vi.fn(async (_dir, rel) =>
        rel.endsWith("/ready") ? ["bug-003.md", "bug-001.md"] : [],
      ),
    });
    const rows = await buildPreview([repo()], [bug], WED_18, "tok", d);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repo: "appbaua",
      taskType: "Bugs",
      mdName: "bug-001.md", // oldest first, same claim order as execute-step
    });
  });

  it("AC: a file-driven type with nothing waiting produces NO row", async () => {
    const [bug] = defaultTaskTypes();
    const rows = await buildPreview([repo()], [bug], WED_18, "tok", deps());
    expect(rows).toEqual([]);
  });

  it("AC: a recurring type shows the placeholder, not a filename", async () => {
    const review: TaskType = {
      id: "code-review",
      label: "Code-Review",
      active: true,
      always: true,
      schedule: emptySchedule(),
    };
    const rows = await buildPreview([repo()], [review], WED_18, "tok", deps());
    expect(rows[0].mdName).toBe("wiederkehrende Aufgabe");
  });

  it("AC: an 'always' type due now gets a queue position", async () => {
    const [bug] = defaultTaskTypes();
    const d = deps({ listReady: vi.fn(async () => ["bug-001.md"]) });
    const rows = await buildPreview([repo()], [bug], WED_18, "tok", d);
    expect(rows[0].due).toEqual({ kind: "queue", position: 0 });
  });

  it("AC: a scheduled type not due yet gets its next window start", async () => {
    const doku: TaskType = {
      id: "doku",
      label: "Doku",
      active: true,
      always: false,
      schedule: emptySchedule(),
    };
    doku.schedule.thu = { enabled: true, start: "02:00", end: "06:00" };
    const rows = await buildPreview(
      [repo()],
      [doku],
      WED_18,
      "tok",
      deps({ listReady: vi.fn(async () => []) }),
    );
    // Doku is not file-driven -> always shows the recurring placeholder,
    // with an "at" due time since it is not due right now.
    expect(rows[0].mdName).toBe("wiederkehrende Aufgabe");
    expect(rows[0].due.kind).toBe("at");
  });

  it("a repo that cannot be prepared contributes no rows, and does not throw", async () => {
    const [bug] = defaultTaskTypes();
    const d = deps({
      prepareRepo: vi.fn(async () => {
        throw new Error("unreachable");
      }),
    });
    const rows = await buildPreview([repo()], [bug], WED_18, "tok", d);
    expect(rows).toEqual([]);
  });

  it("clones each active repo only once, even with several due task types", async () => {
    const [bug, req] = defaultTaskTypes();
    const prepareRepo = vi.fn(async () => ({ dir: "/work/appbaua" }));
    await buildPreview(
      [repo()],
      [bug, req],
      WED_18,
      "tok",
      deps({ prepareRepo, listReady: vi.fn(async () => ["x.md"]) }),
    );
    expect(prepareRepo).toHaveBeenCalledTimes(1);
  });
});
