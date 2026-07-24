// System-Monitor-Kacheln der Einstellungsseite (req-009): Typen, /proc-Parser
// und Formatierung. Bewusst FREI von node:fs — dieses Modul wird auch vom
// Client-Bundle importiert. Das Einlesen der Host-Werte liegt in
// system-metrics-host.ts.

export type DiskMetric = { freeBytes: number; totalBytes: number };
export type CpuMetric = { percent: number };
export type MemoryMetric = {
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
};

/**
 * Momentanwerte des Hosts. Jeder Wert ist einzeln `null`, wenn er sich nicht
 * ermitteln lässt — die übrigen Kacheln funktionieren dann weiter (req-009).
 */
export type SystemMetrics = {
  disk: DiskMetric | null;
  cpu: CpuMetric | null;
  workerCpu: CpuMetric | null;
  memory: MemoryMetric | null;
};

/** Anzeige für einen nicht ermittelbaren Wert. */
export const NOT_AVAILABLE = "n/v";

/** Nichts ermittelbar — jede Kachel zeigt "n/v". */
export const UNKNOWN_METRICS: SystemMetrics = {
  disk: null,
  cpu: null,
  workerCpu: null,
  memory: null,
};

/** Summierte Jiffies der /proc/stat-Zeile "cpu" (alle Kerne zusammen). */
export type CpuTotals = { total: number; idle: number };

/**
 * Liest die aggregierte "cpu"-Zeile aus /proc/stat. `idle` enthält idle+iowait,
 * weil beides keine echte Last ist.
 */
export function parseCpuTotals(procStat: string): CpuTotals | null {
  const line = procStat.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  if (fields.length < 4 || fields.some((n) => !Number.isFinite(n))) return null;
  const total = fields.reduce((a, b) => a + b, 0);
  const idle = fields[3] + (fields[4] ?? 0);
  return { total, idle };
}

/** Auf 0–100 begrenzte, ganzzahlige Prozentangabe. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * Auslastung zwischen zwei /proc/stat-Messungen. `null`, wenn zwischen den
 * Messungen keine Zeit vergangen ist (dann gibt es nichts zu rechnen).
 */
export function cpuBusyPercent(
  prev: CpuTotals,
  next: CpuTotals,
): number | null {
  const total = next.total - prev.total;
  if (!(total > 0)) return null;
  const idle = next.idle - prev.idle;
  return clampPercent(((total - idle) / total) * 100);
}

/** MemTotal/MemAvailable aus /proc/meminfo, in Bytes. */
export function parseMemInfo(procMeminfo: string): MemoryMetric | null {
  const kb = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m").exec(procMeminfo);
    return m ? Number(m[1]) : null;
  };
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (total === null || available === null || total <= 0) return null;
  const free = Math.min(total, Math.max(0, available));
  return {
    usedBytes: (total - free) * 1024,
    freeBytes: free * 1024,
    totalBytes: total * 1024,
  };
}

/**
 * utime+stime (Feld 14+15) aus /proc/<pid>/stat. Der Prozessname in Feld 2 darf
 * Leerzeichen und Klammern enthalten, deshalb wird ab der LETZTEN ")" gezählt.
 */
export function parseProcessJiffies(procPidStat: string): number | null {
  const close = procPidStat.lastIndexOf(")");
  if (close === -1) return null;
  const rest = procPidStat.slice(close + 1).trim().split(/\s+/);
  // rest[0] ist Feld 3 (state) -> Feld 14 = rest[11], Feld 15 = rest[12].
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return utime + stime;
}

/**
 * Woran ein Worker-Prozess auf dem Host erkannt wird. Ohne Docker-Socket bleibt
 * nur die Kommandozeile: die Worker-Schleife (`tsx worker/index.ts`) und der
 * währenddessen laufende Claude-Code-Prozess. Über WORKER_PROCESS_MATCH
 * (kommagetrennt) überschreibbar, falls sich die Aufrufe je ändern.
 */
export const DEFAULT_WORKER_PATTERNS = ["worker/index.ts", "claude"];

/** Zerlegt WORKER_PROCESS_MATCH; leer/ungesetzt -> Standardmuster. */
export function parseWorkerPatterns(raw: string | undefined): string[] {
  const parts = (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : DEFAULT_WORKER_PATTERNS;
}

/** Prüft eine (NUL-getrennte) /proc/<pid>/cmdline gegen die Muster. */
export function isWorkerProcess(
  cmdline: string,
  patterns: string[] = DEFAULT_WORKER_PATTERNS,
): boolean {
  const text = cmdline.replace(/\0/g, " ").trim();
  if (!text) return false; // Kernel-Threads haben eine leere cmdline
  return patterns.some((p) => text.includes(p));
}

const UNITS = [
  { limit: 1e12, suffix: "TB", digits: 1 },
  { limit: 1e9, suffix: "GB", digits: 0 },
  { limit: 1e6, suffix: "MB", digits: 0 },
  { limit: 1e3, suffix: "kB", digits: 0 },
];

/** Bytes als kurze deutsche Größenangabe, z.B. "312 GB" oder "1,4 TB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return NOT_AVAILABLE;
  for (const u of UNITS) {
    if (bytes >= u.limit) {
      return `${(bytes / u.limit).toFixed(u.digits).replace(".", ",")} ${u.suffix}`;
    }
  }
  return `${Math.round(bytes)} B`;
}

/** Prozentwert einer CPU-Kachel, oder "n/v". */
export function formatPercent(metric: CpuMetric | null | undefined): string {
  if (!metric) return NOT_AVAILABLE;
  return `${metric.percent} %`;
}

/** Beschriftung einer Kachel: großer Wert plus kleine Unterzeile. */
export type TileText = { value: string; sub: string };

/** "312 GB frei" / "von 500 GB" — oder "n/v" (req-009). */
export function diskTile(metric: DiskMetric | null | undefined): TileText {
  if (!metric) return { value: NOT_AVAILABLE, sub: "" };
  return {
    value: `${formatBytes(metric.freeBytes)} frei`,
    sub: `von ${formatBytes(metric.totalBytes)}`,
  };
}

/** "12 GB genutzt" / "4 GB frei von 16 GB" — oder "n/v" (req-009). */
export function memoryTile(metric: MemoryMetric | null | undefined): TileText {
  if (!metric) return { value: NOT_AVAILABLE, sub: "" };
  return {
    value: `${formatBytes(metric.usedBytes)} genutzt`,
    sub: `${formatBytes(metric.freeBytes)} frei von ${formatBytes(metric.totalBytes)}`,
  };
}
