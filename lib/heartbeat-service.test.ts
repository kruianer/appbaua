import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryHealthStore, getHealthStore, setHealthStore } from "./health-store";
import {
  createMemoryRunLogStore,
  getRunLogStore,
  setRunLogStore,
} from "./run-log-store";
import type { HeartbeatConfig } from "./heartbeat";
import {
  HEARTBEAT_LOG_LABEL,
  readHeartbeatView,
  runHeartbeatLoop,
  sendHeartbeatNow,
} from "./heartbeat-service";

// req-034 an der Naht: was ein Herzschlag im Speicher und im Verlauf
// hinterlässt — und was NICHT passiert, wenn der Wächter gerade weg ist.

const CONFIG: HeartbeatConfig = {
  url: "https://example.org/watchdog/heartbeat.php",
  token: "geheim",
  intervalMinutes: 5,
};

const NOW = new Date("2026-08-29T12:00:00.000Z");

/** Ein Wächter, der wahlweise annimmt oder nicht erreichbar ist. */
function fetchStub(mode: { ok: boolean; status?: number; throws?: string }) {
  let calls = 0;
  const impl = (async () => {
    calls++;
    if (mode.throws) throw new Error(mode.throws);
    return {
      ok: mode.ok,
      status: mode.status ?? 200,
      json: async () => ({ ok: mode.ok, at: NOW.toISOString() }),
    };
  }) as unknown as typeof fetch;
  return { impl, count: () => calls };
}

beforeEach(() => {
  setHealthStore(createMemoryHealthStore());
  setRunLogStore(createMemoryRunLogStore());
});

describe("Herzschlag senden und merken (req-034)", () => {
  it("merkt sich, wann der Wächter angenommen hat", async () => {
    const { impl } = fetchStub({ ok: true });
    const status = await sendHeartbeatNow({
      config: CONFIG,
      now: () => NOW,
      fetchImpl: impl,
    });

    expect(status).toEqual({ acceptedAt: NOW.toISOString(), error: null });
    expect(await getHealthStore().getHeartbeat()).toEqual(status);
  });

  it("ohne eingerichteten Wächter passiert nichts", async () => {
    const { impl, count } = fetchStub({ ok: true });
    const status = await sendHeartbeatNow({ config: null, now: () => NOW, fetchImpl: impl });

    expect(status).toEqual({ acceptedAt: null, error: null });
    expect(count()).toBe(0);
    expect(await getRunLogStore().count()).toBe(0);
  });

  it("AC: ist der Wächter nicht erreichbar, steht der Versuch im Verlauf", async () => {
    const { impl } = fetchStub({ ok: false, throws: "fetch failed" });
    const status = await sendHeartbeatNow({
      config: CONFIG,
      now: () => NOW,
      fetchImpl: impl,
    });

    // appbaua läuft weiter: kein Wurf nach oben, nur ein vermerkter Fehler.
    expect(status.error).toContain("fetch failed");
    const log = await getRunLogStore().list(0, 10);
    expect(log).toHaveLength(1);
    expect(log[0].taskType).toBe(HEARTBEAT_LOG_LABEL);
    expect(log[0].status).toBe("error");
    expect(log[0].message).toContain("Herzschlag nicht zugestellt");
  });

  it("ein abgewiesener Herzschlag zählt auch als Fehlschlag", async () => {
    const { impl } = fetchStub({ ok: false, status: 403 });
    const status = await sendHeartbeatNow({
      config: CONFIG,
      now: () => NOW,
      fetchImpl: impl,
    });
    expect(status.acceptedAt).toBeNull();
    expect(status.error).toContain("403");
  });

  it("behält den letzten angenommenen Zeitpunkt, wenn ein Versuch scheitert", async () => {
    await sendHeartbeatNow({
      config: CONFIG,
      now: () => NOW,
      fetchImpl: fetchStub({ ok: true }).impl,
    });
    const later = new Date("2026-08-29T12:05:00.000Z");
    const status = await sendHeartbeatNow({
      config: CONFIG,
      now: () => later,
      fetchImpl: fetchStub({ ok: false, throws: "kaputt" }).impl,
    });

    expect(status.acceptedAt).toBe(NOW.toISOString());
    expect(status.error).toContain("kaputt");
  });

  it("schreibt nur den ERSTEN Fehlschlag einer Serie in den Verlauf", async () => {
    const failing = { config: CONFIG, now: () => NOW, fetchImpl: fetchStub({ ok: false, throws: "kaputt" }).impl };
    await sendHeartbeatNow(failing);
    await sendHeartbeatNow(failing);
    await sendHeartbeatNow(failing);

    // Sonst stünden bei einem über Nacht abgeschalteten Hoster hunderte
    // gleichlautende Zeilen im Verlauf.
    expect(await getRunLogStore().count()).toBe(1);
  });

  it("nach einer Erholung wird der nächste Fehlschlag wieder gemeldet", async () => {
    const fail = { config: CONFIG, now: () => NOW, fetchImpl: fetchStub({ ok: false, throws: "kaputt" }).impl };
    await sendHeartbeatNow(fail);
    await sendHeartbeatNow({ config: CONFIG, now: () => NOW, fetchImpl: fetchStub({ ok: true }).impl });
    expect((await getHealthStore().getHeartbeat()).error).toBeNull();

    await sendHeartbeatNow(fail);
    expect(await getRunLogStore().count()).toBe(2);
  });
});

describe("Was die Zustandsseite bekommt (req-034)", () => {
  it("meldet einen eingerichteten Wächter mit seinem Abstand", async () => {
    await sendHeartbeatNow({ config: CONFIG, now: () => NOW, fetchImpl: fetchStub({ ok: true }).impl });
    expect(await readHeartbeatView(CONFIG)).toEqual({
      configured: true,
      intervalMinutes: 5,
      acceptedAt: NOW.toISOString(),
      error: null,
    });
  });

  it("meldet einen fehlenden Wächter als nicht eingerichtet", async () => {
    const view = await readHeartbeatView(null);
    expect(view.configured).toBe(false);
    expect(view.acceptedAt).toBeNull();
  });
});

describe("Der Herzschlag-Takt (req-034)", () => {
  it("AC: schlägt sofort und dann im eingestellten Abstand", async () => {
    const beats: number[] = [];
    const slept: number[] = [];
    let rounds = 0;

    await runHeartbeatLoop({
      config: CONFIG,
      beat: async () => {
        beats.push(1);
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
      keepGoing: () => rounds++ < 3,
    });

    expect(beats).toHaveLength(3);
    // Der erste Schlag kommt VOR der ersten Pause: nach einem Deploy soll der
    // Wächter sofort wieder hören, dass es den Rechner gibt.
    expect(slept).toEqual([5 * 60_000, 5 * 60_000, 5 * 60_000]);
  });

  it("ein gescheiterter Schlag beendet den Takt nicht", async () => {
    let rounds = 0;
    let beats = 0;

    await runHeartbeatLoop({
      config: CONFIG,
      beat: async () => {
        beats++;
        throw new Error("Wächter weg");
      },
      sleep: async () => {},
      keepGoing: () => rounds++ < 3,
    });

    expect(beats).toBe(3);
  });
});
