import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryTaskStore, setTaskStore, getTaskStore } from "./task-store";
import {
  listTaskTypes,
  reorderTaskTypes,
  setDaySchedule,
  toggleAlways,
  toggleTaskType,
} from "./task-service";
import { runsAlways } from "./task-types";

beforeEach(() => {
  setTaskStore(createMemoryTaskStore());
});

// Each test maps to an acceptance criterion in req-002.

describe("req-002 acceptance criteria", () => {
  it("AC: first open shows the predefined types in vision order", async () => {
    const types = await listTaskTypes();
    expect(types.map((t) => t.label)).toEqual([
      "Bugs",
      "Requirements",
      "Code-Review",
      "Security",
      "Doku",
      "Ideen",
    ]);
  });

  it("AC: drag Requirements to position 1 persists the new order", async () => {
    const before = await listTaskTypes();
    const ids = before.map((t) => t.id);
    // move "requirement" to the front
    const reordered = [
      "requirement",
      ...ids.filter((id) => id !== "requirement"),
    ];
    await reorderTaskTypes(reordered);
    const after = await getTaskStore().list(); // re-read = persistence
    expect(after[0].label).toBe("Requirements");
  });

  it("AC: toggling Doku inactive keeps position and keeps its schedule", async () => {
    // give Doku a schedule first
    await setDaySchedule("doku", "wed", {
      enabled: true,
      start: "09:00",
      end: "12:00",
    });
    const posBefore = (await listTaskTypes()).findIndex((t) => t.id === "doku");
    const after = await toggleTaskType("doku");
    const doku = after.find((t) => t.id === "doku")!;
    expect(after.findIndex((t) => t.id === "doku")).toBe(posBefore);
    expect(doku.active).toBe(false);
    expect(doku.schedule.wed).toEqual({
      enabled: true,
      start: "09:00",
      end: "12:00",
    });
  });

  it("AC: setting Code-Review Wed 17:00–19:00 is saved", async () => {
    const res = await setDaySchedule("code-review", "wed", {
      enabled: true,
      start: "17:00",
      end: "19:00",
    });
    expect(res.ok).toBe(true);
    const cr = (await getTaskStore().list()).find((t) => t.id === "code-review")!;
    expect(cr.schedule.wed).toEqual({
      enabled: true,
      start: "17:00",
      end: "19:00",
    });
  });

  it("AC: enabling a day with empty fields prefills 00:00–23:59", async () => {
    await setDaySchedule("ideen", "mon", {
      enabled: true,
      start: null,
      end: null,
    });
    const ideen = (await listTaskTypes()).find((t) => t.id === "ideen")!;
    expect(ideen.schedule.mon).toEqual({
      enabled: true,
      start: "00:00",
      end: "23:59",
    });
  });

  // Superseded by bug-004: end-before-start is now a window over midnight.
  // Identical start/end stays the rejected case.
  it("AC: an empty window (19:00–19:00) is rejected and nothing is saved", async () => {
    const res = await setDaySchedule("bug", "tue", {
      enabled: true,
      start: "19:00",
      end: "19:00",
    });
    expect(res).toEqual({ ok: false, error: "invalid-window" });
    const bug = (await getTaskStore().list()).find((t) => t.id === "bug")!;
    expect(bug.schedule.tue.enabled).toBe(false); // unchanged
  });

  it("AC: a type defaults to always-on (runs always)", async () => {
    const req = (await listTaskTypes()).find((t) => t.id === "requirement")!;
    expect(req.always).toBe(true);
    expect(runsAlways(req)).toBe(true);
  });

  it("AC: toggling 'immer' off keeps the underlying schedule", async () => {
    await setDaySchedule("requirement", "wed", {
      enabled: true,
      start: "17:00",
      end: "19:00",
    });
    const off = await toggleAlways("requirement");
    const req = off.find((t) => t.id === "requirement")!;
    expect(req.always).toBe(false); // weekday view would now show
    expect(req.schedule.wed).toEqual({
      enabled: true,
      start: "17:00",
      end: "19:00",
    }); // schedule preserved underneath
  });

  it("bug-004 AC: Monday 22:00–06:00 is accepted and persisted", async () => {
    const res = await setDaySchedule("bug", "mon", {
      enabled: true,
      start: "22:00",
      end: "06:00",
    });
    expect(res.ok).toBe(true);
    const bug = (await getTaskStore().list()).find((t) => t.id === "bug")!;
    expect(bug.schedule.mon).toEqual({
      enabled: true,
      start: "22:00",
      end: "06:00",
    }); // re-read from the store = it stays
  });

  // req-014: Security is a task type like any other — switchable and
  // schedulable.
  it("AC: the Security type can be switched off and scheduled", async () => {
    const off = await toggleTaskType("security");
    expect(off.find((t) => t.id === "security")!.active).toBe(false);
    const res = await setDaySchedule("security", "sat", {
      enabled: true,
      start: "22:00",
      end: "23:00",
    });
    expect(res.ok).toBe(true);
    const sec = (await getTaskStore().list()).find((t) => t.id === "security")!;
    expect(sec.schedule.sat.start).toBe("22:00");
  });

  it("only-one-side window gets the empty side prefilled (09:00–23:59)", async () => {
    const res = await setDaySchedule("bug", "mon", {
      enabled: true,
      start: "09:00",
      end: null,
    });
    expect(res.ok).toBe(true);
    const bug = (await listTaskTypes()).find((t) => t.id === "bug")!;
    expect(bug.schedule.mon).toEqual({
      enabled: true,
      start: "09:00",
      end: "23:59",
    });
  });
});
