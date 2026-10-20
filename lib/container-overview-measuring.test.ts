import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import { readContainerOverview } from "./container-overview-service";

// req-042, AC12: direkt nach dem Start ist noch keine Messrunde gelaufen.
// Eigene Datei, damit das Modul garantiert frisch ist — ein anderer Test, der
// vorher schon runContainerMeasurement aufgerufen hat, dürfte diesen Zustand
// sonst gar nicht mehr zeigen.

beforeEach(() => {
  setStore(createMemoryStore([]));
});

describe("readContainerOverview — vor der ersten Messrunde", () => {
  it("AC: zeigt 'wird gemessen', keine leere Seite ohne Erklärung", async () => {
    const { groups, measuring } = await readContainerOverview();
    expect(measuring).toBe(true);
    expect(groups).toEqual([]);
  });
});
