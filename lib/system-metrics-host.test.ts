import { describe, it, expect } from "vitest";
import {
  BOOTSTRAP_DELAY_MS,
  MAX_BASELINE_AGE_MS,
  type HostSource,
  type SampleCache,
  collectSystemMetrics,
} from "./system-metrics-host";
import { DEFAULT_WORKER_PATTERNS, type DiskMetric } from "./system-metrics";

// Erhebung der Host-Werte (req-009) gegen ein nachgebautes /proc — so ist
// prüfbar, dass ein einzelner unlesbarer Wert die übrigen Kacheln nicht
// mitreißt und dass zwischen zwei Anfragen kein Messen im Leerlauf passiert.

const MEMINFO = [
  "MemTotal:       16000000 kB",
  "MemFree:         1000000 kB",
  "MemAvailable:    4000000 kB",
].join("\n");

const DISK: DiskMetric = { freeBytes: 312_000_000_000, totalBytes: 500_000_000_000 };

type Proc = { pid: number; cmdline: string; utime: number; stime: number };

/** Ein Zustand des Hosts zu einem Zeitpunkt. */
type Frame = {
  /** null = /proc/stat nicht lesbar */
  cpu: { user: number; idle: number } | null;
  procs: Proc[];
};

function procStat(user: number, idle: number): string {
  return `cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 ${user} 0 0 ${idle} 0 0 0 0 0 0\nintr 1 2 3`;
}

function pidStat(p: Proc): string {
  return `${p.pid} (node) S 1 ${p.pid} ${p.pid} 0 -1 4194304 0 0 0 0 ${p.utime} ${p.stime} 0 0 20 0 4 0 999`;
}

const worker = (utime: number, stime = 0): Proc => ({
  pid: 101,
  cmdline: "tsx\0worker/index.ts\0",
  utime,
  stime,
});

const claude = (utime: number): Proc => ({
  pid: 202,
  cmdline: "/usr/local/bin/claude\0-p\0arbeite\0",
  utime,
  stime: 0,
});

const stranger = (utime: number): Proc => ({
  pid: 303,
  cmdline: "postgres:\0checkpointer\0",
  utime,
  stime: 0,
});

function fakeHost(
  frames: Frame[],
  over: { meminfo?: string | null; disk?: DiskMetric | null } = {},
) {
  let index = 0;
  let now = 10_000;
  const sleeps: number[] = [];
  const frame = () => frames[Math.min(index, frames.length - 1)];

  const src: HostSource = {
    async readText(relPath) {
      if (relPath === "stat") {
        const cpu = frame().cpu;
        return cpu ? procStat(cpu.user, cpu.idle) : null;
      }
      if (relPath === "meminfo") return over.meminfo === undefined ? MEMINFO : over.meminfo;
      const m = /^(\d+)\/(stat|cmdline)$/.exec(relPath);
      if (!m) return null;
      const proc = frame().procs.find((p) => p.pid === Number(m[1]));
      if (!proc) return null;
      return m[2] === "cmdline" ? proc.cmdline : pidStat(proc);
    },
    async listPids() {
      return frame().procs.map((p) => p.pid);
    },
    async diskUsage() {
      return over.disk === undefined ? DISK : over.disk;
    },
    nowMs: () => now,
    async sleep(ms) {
      sleeps.push(ms);
      now += ms;
      index += 1; // während der Wartezeit tickt der Host weiter
    },
  };

  return {
    src,
    sleeps,
    /** Zeit zwischen zwei Anfragen der Einstellungsseite. */
    advance(ms: number) {
      now += ms;
      index += 1;
    },
  };
}

const emptyCache = (): SampleCache => ({ last: null });

const collect = (host: ReturnType<typeof fakeHost>, cache: SampleCache) =>
  collectSystemMetrics(host.src, cache, DEFAULT_WORKER_PATTERNS);

// 200 Jiffies vergangen, 100 davon idle -> 50 % gesamt.
// Der Worker verbraucht 20 der 200 -> 10 %.
const BUSY_FRAMES: Frame[] = [
  { cpu: { user: 100, idle: 400 }, procs: [worker(10, 10), stranger(5)] },
  { cpu: { user: 200, idle: 500 }, procs: [worker(30, 10), stranger(5)] },
  { cpu: { user: 250, idle: 700 }, procs: [worker(50, 10), stranger(5)] },
];

describe("collectSystemMetrics — erste Anfrage", () => {
  it("misst ohne Bezugspunkt selbst zweimal und liefert alle vier Werte", async () => {
    const host = fakeHost(BUSY_FRAMES);
    const metrics = await collect(host, emptyCache());

    expect(host.sleeps).toEqual([BOOTSTRAP_DELAY_MS]);
    expect(metrics.cpu).toEqual({ percent: 50 });
    expect(metrics.workerCpu).toEqual({ percent: 10 });
    expect(metrics.disk).toEqual(DISK);
    expect(metrics.memory).toEqual({
      usedBytes: 12_288_000_000,
      freeBytes: 4_096_000_000,
      totalBytes: 16_384_000_000,
    });
  });
});

describe("collectSystemMetrics — Folgeanfragen", () => {
  it("nimmt die letzte Messung als Bezugspunkt, statt erneut zu warten", async () => {
    const host = fakeHost(BUSY_FRAMES);
    const cache = emptyCache();
    await collect(host, cache);

    host.advance(1000); // eine Sekunde später fragt die Seite erneut
    const metrics = await collect(host, cache);

    // Kein zweites Bootstrap: die Sekunde zwischen den Anfragen IST das Fenster.
    expect(host.sleeps).toEqual([BOOTSTRAP_DELAY_MS]);
    // 250 Jiffies vergangen, 200 davon idle -> 20 %; Worker 20 von 250 -> 8 %.
    expect(metrics.cpu).toEqual({ percent: 20 });
    expect(metrics.workerCpu).toEqual({ percent: 8 });
  });

  it("verwirft einen veralteten Bezugspunkt (Seite war lange zu)", async () => {
    const host = fakeHost(BUSY_FRAMES);
    const cache = emptyCache();
    await collect(host, cache);

    host.advance(MAX_BASELINE_AGE_MS + 1);
    await collect(host, cache);

    expect(host.sleeps).toEqual([BOOTSTRAP_DELAY_MS, BOOTSTRAP_DELAY_MS]);
  });
});

describe("collectSystemMetrics — CPU-Last des Workers", () => {
  it("AC: mit laufendem Claude-Prozess deutlich höher als im Leerlauf", async () => {
    // Gleiches CPU-Fenster (200 Jiffies), einmal ohne und einmal mit Claude.
    const idle: Frame[] = [
      { cpu: { user: 100, idle: 400 }, procs: [worker(10, 10)] },
      { cpu: { user: 200, idle: 500 }, procs: [worker(12, 10)] },
    ];
    const running: Frame[] = [
      { cpu: { user: 100, idle: 400 }, procs: [worker(10, 10), claude(0)] },
      { cpu: { user: 200, idle: 500 }, procs: [worker(12, 10), claude(138)] },
    ];

    const quiet = await collect(fakeHost(idle), emptyCache());
    const busy = await collect(fakeHost(running), emptyCache());

    expect(quiet.workerCpu).toEqual({ percent: 1 }); // 2 von 200
    expect(busy.workerCpu).toEqual({ percent: 70 }); // 140 von 200
    expect(busy.workerCpu?.percent ?? 0).toBeGreaterThan(
      (quiet.workerCpu?.percent ?? 0) + 20,
    );
  });

  it("zählt fremde Prozesse nicht mit", async () => {
    const frames: Frame[] = [
      { cpu: { user: 100, idle: 400 }, procs: [worker(10, 10), stranger(0)] },
      { cpu: { user: 200, idle: 500 }, procs: [worker(10, 10), stranger(180)] },
    ];
    const metrics = await collect(fakeHost(frames), emptyCache());
    expect(metrics.workerCpu).toEqual({ percent: 0 });
    expect(metrics.cpu).toEqual({ percent: 50 });
  });

  it("ein beendeter Prozess ergibt 0 statt einer negativen Last", async () => {
    const frames: Frame[] = [
      { cpu: { user: 100, idle: 400 }, procs: [worker(10, 10), claude(500)] },
      { cpu: { user: 200, idle: 500 }, procs: [worker(10, 10)] },
    ];
    const metrics = await collect(fakeHost(frames), emptyCache());
    expect(metrics.workerCpu).toEqual({ percent: 0 });
  });

  it("kein sichtbarer Worker-Prozess -> n/v, CPU gesamt bleibt", async () => {
    const frames: Frame[] = [
      { cpu: { user: 100, idle: 400 }, procs: [stranger(0)] },
      { cpu: { user: 200, idle: 500 }, procs: [stranger(50)] },
    ];
    const metrics = await collect(fakeHost(frames), emptyCache());
    expect(metrics.workerCpu).toBeNull();
    expect(metrics.cpu).toEqual({ percent: 50 });
  });
});

describe("collectSystemMetrics — einzelne Werte fallen aus", () => {
  it("AC: /proc/stat unlesbar -> beide CPU-Kacheln n/v, Disk und RAM bleiben", async () => {
    const frames: Frame[] = [
      { cpu: null, procs: [worker(10, 10)] },
      { cpu: null, procs: [worker(30, 10)] },
    ];
    const metrics = await collect(fakeHost(frames), emptyCache());

    expect(metrics.cpu).toBeNull();
    expect(metrics.workerCpu).toBeNull();
    expect(metrics.disk).toEqual(DISK);
    expect(metrics.memory).not.toBeNull();
  });

  it("AC: Datenträger unlesbar -> nur die Speicher-Kachel n/v", async () => {
    const metrics = await collect(
      fakeHost(BUSY_FRAMES, { disk: null }),
      emptyCache(),
    );

    expect(metrics.disk).toBeNull();
    expect(metrics.cpu).toEqual({ percent: 50 });
    expect(metrics.workerCpu).toEqual({ percent: 10 });
    expect(metrics.memory).not.toBeNull();
  });

  it("AC: /proc/meminfo unlesbar -> nur die RAM-Kachel n/v", async () => {
    const metrics = await collect(
      fakeHost(BUSY_FRAMES, { meminfo: null }),
      emptyCache(),
    );

    expect(metrics.memory).toBeNull();
    expect(metrics.disk).toEqual(DISK);
    expect(metrics.cpu).toEqual({ percent: 50 });
  });
});
