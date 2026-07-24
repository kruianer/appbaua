import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORKER_PATTERNS,
  NOT_AVAILABLE,
  clampPercent,
  cpuBusyPercent,
  diskTile,
  formatBytes,
  formatPercent,
  isWorkerProcess,
  memoryTile,
  parseCpuTotals,
  parseMemInfo,
  parseProcessJiffies,
  parseWorkerPatterns,
} from "./system-metrics";

// Parser und Beschriftung der System-Kacheln (req-009). Alles hier ist rein —
// das Einlesen des Hosts steckt in system-metrics-host.ts.

const PROC_STAT = [
  "cpu  100 20 30 400 50 0 0 0 0 0",
  "cpu0 50 10 15 200 25 0 0 0 0 0",
  "intr 12345 1 2 3",
  "ctxt 98765",
].join("\n");

describe("parseCpuTotals", () => {
  it("summiert alle Felder der cpu-Zeile; idle enthält iowait", () => {
    expect(parseCpuTotals(PROC_STAT)).toEqual({ total: 600, idle: 450 });
  });

  it("ignoriert die Zeilen einzelner Kerne", () => {
    // Nur cpu0 wäre 300/225 — die Aggregatzeile muss gewinnen.
    expect(parseCpuTotals(PROC_STAT)?.total).toBe(600);
  });

  it("null, wenn keine cpu-Zeile da ist", () => {
    expect(parseCpuTotals("intr 1 2 3\nctxt 4")).toBeNull();
  });

  it("null bei unbrauchbaren Feldern", () => {
    expect(parseCpuTotals("cpu  a b c d")).toBeNull();
    expect(parseCpuTotals("cpu  1 2")).toBeNull();
  });
});

describe("cpuBusyPercent", () => {
  it("rechnet die Auslastung zwischen zwei Messungen", () => {
    // 200 Jiffies vergangen, davon 100 idle -> 50 %.
    const busy = cpuBusyPercent({ total: 600, idle: 450 }, { total: 800, idle: 550 });
    expect(busy).toBe(50);
  });

  it("volle Last, wenn nichts davon idle war", () => {
    expect(cpuBusyPercent({ total: 600, idle: 450 }, { total: 700, idle: 450 })).toBe(
      100,
    );
  });

  it("null, wenn zwischen den Messungen keine Zeit vergangen ist", () => {
    expect(cpuBusyPercent({ total: 600, idle: 450 }, { total: 600, idle: 450 })).toBeNull();
  });
});

describe("clampPercent", () => {
  it("begrenzt auf 0..100 und rundet", () => {
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(12.6)).toBe(13);
  });

  it("0 statt NaN", () => {
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe("parseMemInfo", () => {
  const MEMINFO = [
    "MemTotal:       16000000 kB",
    "MemFree:         1000000 kB",
    "MemAvailable:    4000000 kB",
    "Buffers:          100000 kB",
  ].join("\n");

  it("nutzt MemAvailable als frei — nicht MemFree", () => {
    expect(parseMemInfo(MEMINFO)).toEqual({
      usedBytes: 12_288_000_000,
      freeBytes: 4_096_000_000,
      totalBytes: 16_384_000_000,
    });
  });

  it("null, wenn Felder fehlen", () => {
    expect(parseMemInfo("MemTotal: 16000000 kB")).toBeNull();
    expect(parseMemInfo("")).toBeNull();
  });
});

describe("parseProcessJiffies", () => {
  it("summiert utime und stime", () => {
    const stat =
      "1234 (node) S 1 1234 1234 0 -1 4194304 100 200 0 0 42 8 0 0 20 0 5 0 999";
    expect(parseProcessJiffies(stat)).toBe(50);
  });

  it("kommt mit Klammern und Leerzeichen im Prozessnamen klar", () => {
    const stat = "7 (my (weird) proc) S 1 7 7 0 -1 0 0 0 0 0 11 4 0 0 20 0 1 0 9";
    expect(parseProcessJiffies(stat)).toBe(15);
  });

  it("null bei kaputter Zeile", () => {
    expect(parseProcessJiffies("kein klammerauf-zu")).toBeNull();
    expect(parseProcessJiffies("1 (node) S 1")).toBeNull();
  });
});

describe("isWorkerProcess", () => {
  it("erkennt die Worker-Schleife und den Claude-Prozess", () => {
    expect(isWorkerProcess("tsx\0worker/index.ts\0")).toBe(true);
    expect(isWorkerProcess("/usr/local/bin/claude\0-p\0los\0")).toBe(true);
  });

  it("lässt fremde Prozesse aus", () => {
    expect(isWorkerProcess("node\0server.js\0")).toBe(false);
    expect(isWorkerProcess("postgres: checkpointer\0")).toBe(false);
  });

  it("Kernel-Threads haben eine leere cmdline", () => {
    expect(isWorkerProcess("")).toBe(false);
    expect(isWorkerProcess("\0\0")).toBe(false);
  });

  it("respektiert eigene Muster", () => {
    expect(isWorkerProcess("node\0server.js\0", ["server.js"])).toBe(true);
    expect(isWorkerProcess("tsx\0worker/index.ts\0", ["server.js"])).toBe(false);
  });
});

describe("parseWorkerPatterns", () => {
  it("zerlegt eine kommagetrennte Liste", () => {
    expect(parseWorkerPatterns("a, b ,, c")).toEqual(["a", "b", "c"]);
  });

  it("fällt ohne Angabe auf die Standardmuster zurück", () => {
    expect(parseWorkerPatterns(undefined)).toEqual(DEFAULT_WORKER_PATTERNS);
    expect(parseWorkerPatterns("   ")).toEqual(DEFAULT_WORKER_PATTERNS);
  });
});

describe("formatBytes", () => {
  it("kürzt auf eine lesbare Einheit", () => {
    expect(formatBytes(500_000_000_000)).toBe("500 GB");
    expect(formatBytes(312_000_000_000)).toBe("312 GB");
    expect(formatBytes(1_400_000_000_000)).toBe("1,4 TB");
    expect(formatBytes(750_000_000)).toBe("750 MB");
    expect(formatBytes(0)).toBe("0 B");
  });

  it("n/v bei unbrauchbaren Zahlen", () => {
    expect(formatBytes(-1)).toBe(NOT_AVAILABLE);
    expect(formatBytes(Number.NaN)).toBe(NOT_AVAILABLE);
  });
});

describe("formatPercent", () => {
  it("hängt das Prozentzeichen an", () => {
    expect(formatPercent({ percent: 37 })).toBe("37 %");
  });

  it("AC: nicht ermittelbar -> n/v", () => {
    expect(formatPercent(null)).toBe(NOT_AVAILABLE);
    expect(formatPercent(undefined)).toBe(NOT_AVAILABLE);
  });
});

describe("diskTile", () => {
  it("zeigt frei von gesamt", () => {
    expect(diskTile({ freeBytes: 312_000_000_000, totalBytes: 500_000_000_000 })).toEqual(
      { value: "312 GB frei", sub: "von 500 GB" },
    );
  });

  it("AC: nicht ermittelbar -> n/v", () => {
    expect(diskTile(null)).toEqual({ value: NOT_AVAILABLE, sub: "" });
  });
});

describe("memoryTile", () => {
  it("zeigt genutzt, frei und gesamt", () => {
    expect(
      memoryTile({
        usedBytes: 12_288_000_000,
        freeBytes: 4_096_000_000,
        totalBytes: 16_384_000_000,
      }),
    ).toEqual({ value: "12 GB genutzt", sub: "4 GB frei von 16 GB" });
  });

  it("AC: nicht ermittelbar -> n/v", () => {
    expect(memoryTile(null)).toEqual({ value: NOT_AVAILABLE, sub: "" });
  });
});
