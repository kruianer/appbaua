import { describe, it, expect } from "vitest";
import { CHECK_KINDS } from "./health";
import {
  DEFAULT_HEALTH_SETTINGS,
  intervalMsFor,
  normalizeSettings,
} from "./health-settings";

// req-032: die Vorgaben der Prüfabstände und was mit unsinnigen Werten passiert.

describe("Vorgaben", () => {
  it("AC: 5 Minuten für die laufenden Prüfungen, 24 Stunden für die KI", () => {
    expect(DEFAULT_HEALTH_SETTINGS.intervalMinutes).toBe(5);
    expect(DEFAULT_HEALTH_SETTINGS.aiIntervalHours).toBe(24);
  });

  it("jede Prüfart ist zunächst eingeschaltet", () => {
    for (const kind of CHECK_KINDS) {
      expect(DEFAULT_HEALTH_SETTINGS.checks[kind]).toBe(true);
    }
  });
});

describe("normalizeSettings", () => {
  it("übernimmt gültige Werte", () => {
    const s = normalizeSettings({
      intervalMinutes: 10,
      aiIntervalHours: 6,
      checks: { ai: false, web: false },
    });
    expect(s.intervalMinutes).toBe(10);
    expect(s.aiIntervalHours).toBe(6);
    expect(s.checks.ai).toBe(false);
    expect(s.checks.web).toBe(false);
    expect(s.checks.container).toBe(true);
  });

  it("fängt 0 und negative Abstände ab — das wäre Dauerlast", () => {
    expect(normalizeSettings({ intervalMinutes: 0 }).intervalMinutes).toBe(1);
    expect(normalizeSettings({ aiIntervalHours: -5 }).aiIntervalHours).toBe(1);
  });

  it("fällt bei Unsinn auf die Vorgabe zurück, statt eine Prüfart abzuschalten", () => {
    const s = normalizeSettings({ intervalMinutes: "bald", checks: { ai: "nein" } });
    expect(s.intervalMinutes).toBe(5);
    expect(s.checks.ai).toBe(true);
  });

  it("verträgt null und undefined", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_HEALTH_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_HEALTH_SETTINGS);
  });
});

describe("intervalMsFor", () => {
  it("die KI-Prüfung rechnet in Stunden, alle anderen in Minuten", () => {
    const s = normalizeSettings({ intervalMinutes: 5, aiIntervalHours: 24 });
    expect(intervalMsFor("container", s)).toBe(5 * 60_000);
    expect(intervalMsFor("ai", s)).toBe(24 * 60 * 60_000);
  });
});
