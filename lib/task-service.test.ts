import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryTaskStore, setTaskStore, getTaskStore } from "./task-store";
import {
  listTaskTypes,
  reorderTaskTypes,
  setDaySchedule,
  toggleTaskType,
} from "./task-service";
import { runsAlways } from "./task-types";

beforeEach(() => {
  setTaskStore(createMemoryTaskStore());
});

// Each test maps to an acceptance criterion in req-002.

describe("req-002 acceptance criteria", () => {
  it("AC: first open shows the five types in vision order", async () => {
    const types = await listTaskTypes();
    expect(types.map((t) => t.label)).toEqual([
      "Bugs",
      "Requirements",
      "Code-Review",
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

  it("AC: a day enabled without a window counts as all day", async () => {
    await setDaySchedule("ideen", "mon", {
      enabled: true,
      start: null,
      end: null,
    });
    const ideen = (await listTaskTypes()).find((t) => t.id === "ideen")!;
    expect(ideen.schedule.mon).toEqual({
      enabled: true,
      start: null,
      end: null,
    });
  });

  it("AC: end-before-start (19:00–17:00) is rejected and nothing is saved", async () => {
    const res = await setDaySchedule("bug", "tue", {
      enabled: true,
      start: "19:00",
      end: "17:00",
    });
    expect(res).toEqual({ ok: false, error: "invalid-window" });
    const bug = (await getTaskStore().list()).find((t) => t.id === "bug")!;
    expect(bug.schedule.tue.enabled).toBe(false); // unchanged
  });

  it("AC: an active type with no weekdays runs always", async () => {
    const req = (await listTaskTypes()).find((t) => t.id === "requirement")!;
    expect(runsAlways(req)).toBe(true);
  });

  it("only-one-side window is rejected", async () => {
    const res = await setDaySchedule("bug", "mon", {
      enabled: true,
      start: "09:00",
      end: null,
    });
    expect(res).toEqual({ ok: false, error: "invalid-window" });
  });
});
