import { describe, it, expect } from "vitest";
import {
  DEFAULT_HEARTBEAT_MINUTES,
  HEARTBEAT_TOKEN_HEADER,
  MAX_HEARTBEAT_MINUTES,
  MIN_HEARTBEAT_MINUTES,
  acceptedAtFrom,
  intervalMs,
  normalizeHeartbeatStatus,
  readHeartbeatConfig,
  sendHeartbeat,
} from "./heartbeat";

// Der Herzschlag nach draußen (req-034), ohne Speicher und ohne Netz.

const CONFIG = {
  url: "https://example.org/watchdog/heartbeat.php",
  token: "geheim",
  intervalMinutes: 5,
};

const NOW = new Date("2026-08-29T12:00:00.000Z");

/** Ein Wächter, der mitschreibt statt zu antworten. */
function fetchStub(res: { ok: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 500),
      json: async () => res.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Zugangsdaten des Wächters (req-034)", () => {
  it("ohne Adresse oder Kennung ist kein Wächter eingerichtet", () => {
    expect(readHeartbeatConfig({})).toBeNull();
    expect(readHeartbeatConfig({ WATCHDOG_URL: "https://x/y.php" })).toBeNull();
    expect(readHeartbeatConfig({ WATCHDOG_TOKEN: "geheim" })).toBeNull();
    // Leerzeichen sind keine Kennung.
    expect(
      readHeartbeatConfig({ WATCHDOG_URL: "https://x/y.php", WATCHDOG_TOKEN: "  " }),
    ).toBeNull();
  });

  it("nimmt den vorgesehenen Abstand, wenn keiner gesetzt ist", () => {
    const config = readHeartbeatConfig({
      WATCHDOG_URL: "https://x/y.php",
      WATCHDOG_TOKEN: "geheim",
    });
    expect(config?.intervalMinutes).toBe(DEFAULT_HEARTBEAT_MINUTES);
    expect(intervalMs(config!)).toBe(DEFAULT_HEARTBEAT_MINUTES * 60_000);
  });

  it("deckelt den Abstand — ein zu großer wäre ein Dauerfehlalarm", () => {
    const env = { WATCHDOG_URL: "https://x/y.php", WATCHDOG_TOKEN: "geheim" };
    // Der Wächter meldet nach 15 Minuten. Alles darüber MUSS gedeckelt werden.
    expect(
      readHeartbeatConfig({ ...env, WATCHDOG_INTERVAL_MINUTES: "60" })?.intervalMinutes,
    ).toBe(MAX_HEARTBEAT_MINUTES);
    expect(MAX_HEARTBEAT_MINUTES).toBeLessThan(15);
    expect(
      readHeartbeatConfig({ ...env, WATCHDOG_INTERVAL_MINUTES: "0" })?.intervalMinutes,
    ).toBe(DEFAULT_HEARTBEAT_MINUTES);
    expect(
      readHeartbeatConfig({ ...env, WATCHDOG_INTERVAL_MINUTES: "-3" })?.intervalMinutes,
    ).toBe(DEFAULT_HEARTBEAT_MINUTES);
    expect(
      readHeartbeatConfig({ ...env, WATCHDOG_INTERVAL_MINUTES: "1" })?.intervalMinutes,
    ).toBe(MIN_HEARTBEAT_MINUTES);
  });
});

describe("Einen Herzschlag senden (req-034)", () => {
  it("schickt die Kennung im Header und sonst nur den Zeitpunkt", async () => {
    const { impl, calls } = fetchStub({ ok: true, body: { ok: true } });
    await sendHeartbeat(CONFIG, NOW, impl);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CONFIG.url);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers[HEARTBEAT_TOKEN_HEADER]).toBe("geheim");
    // Über die überwachten Apps steht hier NICHTS drin (req-034).
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ at: NOW.toISOString() });
  });

  it("übernimmt den Zeitpunkt, den der Wächter bestätigt", async () => {
    const { impl } = fetchStub({ ok: true, body: { ok: true, at: "2026-08-29T12:00:07+00:00" } });
    expect(await sendHeartbeat(CONFIG, NOW, impl)).toBe("2026-08-29T12:00:07.000Z");
  });

  it("nimmt die eigene Uhr, wenn der Wächter keinen Zeitpunkt nennt", async () => {
    expect(acceptedAtFrom({ ok: true }, NOW)).toBe(NOW.toISOString());
    expect(acceptedAtFrom({ at: "kein Datum" }, NOW)).toBe(NOW.toISOString());
    expect(acceptedAtFrom(null, NOW)).toBe(NOW.toISOString());
  });

  it("eine abgewiesene Kennung ist ein Fehler, kein stiller Erfolg", async () => {
    const { impl } = fetchStub({ ok: false, status: 403 });
    await expect(sendHeartbeat(CONFIG, NOW, impl)).rejects.toThrow("403");
  });
});

describe("Gemerkter Stand", () => {
  it("macht aus allem, was der Speicher hergibt, eine brauchbare Form", () => {
    expect(normalizeHeartbeatStatus(undefined)).toEqual({ acceptedAt: null, error: null });
    expect(normalizeHeartbeatStatus({ acceptedAt: 42, error: "" })).toEqual({
      acceptedAt: null,
      error: null,
    });
    expect(normalizeHeartbeatStatus({ acceptedAt: "x", error: "weg" })).toEqual({
      acceptedAt: "x",
      error: "weg",
    });
  });
});
