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

  it("die Telegram-Meldungen sind zunächst eingeschaltet (req-033)", () => {
    expect(DEFAULT_HEALTH_SETTINGS.telegram).toBe(true);
  });

  it("AC: die Log-Analyse läuft zunächst einmal täglich (req-035)", () => {
    expect(DEFAULT_HEALTH_SETTINGS.logAnalysis).toBe(true);
    expect(DEFAULT_HEALTH_SETTINGS.logAnalysisOnFailure).toBe(true);
    expect(DEFAULT_HEALTH_SETTINGS.logAnalysisIntervalHours).toBe(24);
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

  it("schaltet die Telegram-Meldungen ab, ohne eine Prüfart anzufassen (req-033)", () => {
    const s = normalizeSettings({ telegram: false });
    expect(s.telegram).toBe(false);
    for (const kind of CHECK_KINDS) expect(s.checks[kind]).toBe(true);
  });

  it("ein vor req-033 gespeicherter Stand kennt das Feld nicht — das heißt nicht 'stumm'", () => {
    expect(normalizeSettings({ intervalMinutes: 10 }).telegram).toBe(true);
    expect(normalizeSettings({ telegram: "nein" }).telegram).toBe(true);
  });

  it("schaltet die Log-Analyse einzeln ab, ohne die Überwachung anzufassen (req-035)", () => {
    const s = normalizeSettings({ logAnalysis: false });
    expect(s.logAnalysis).toBe(false);
    // Der Weg bei einem Ausfall ist getrennt schaltbar und bleibt an.
    expect(s.logAnalysisOnFailure).toBe(true);
    for (const kind of CHECK_KINDS) expect(s.checks[kind]).toBe(true);

    const both = normalizeSettings({ logAnalysis: false, logAnalysisOnFailure: false });
    expect(both.logAnalysisOnFailure).toBe(false);
  });

  it("ein vor req-035 gespeicherter Stand kennt die Felder nicht — das heißt nicht 'aus'", () => {
    const s = normalizeSettings({ intervalMinutes: 10 });
    expect(s.logAnalysis).toBe(true);
    expect(s.logAnalysisOnFailure).toBe(true);
    expect(s.logAnalysisIntervalHours).toBe(24);
  });

  it("fängt 0 und negative Abstände ab — das wäre Dauerlast", () => {
    expect(normalizeSettings({ intervalMinutes: 0 }).intervalMinutes).toBe(1);
    expect(normalizeSettings({ aiIntervalHours: -5 }).aiIntervalHours).toBe(1);
    expect(normalizeSettings({ logAnalysisIntervalHours: 0 }).logAnalysisIntervalHours).toBe(1);
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
