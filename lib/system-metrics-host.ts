// Erhebt die Momentanwerte des Hosts für die System-Kacheln (req-009).
//
// Ohne Docker-Socket: Das Host-/proc und der Datenträger werden read-only in
// den App-Container gemountet (siehe docker-compose.yml). Weil im Host-/proc
// ALLE Prozesse des Rechners stehen — auch die des Worker-Containers —, lässt
// sich die CPU-Last des Workers (Worker-Schleife + laufender Claude-Prozess)
// allein daraus bestimmen.
//
// Kein Hintergrund-Polling: gemessen wird ausschließlich, wenn die
// Einstellungsseite einen Wert anfragt. Es läuft kein Timer im Server.

import { promises as fsp } from "node:fs";
import path from "node:path";
import {
  type CpuTotals,
  type DiskMetric,
  type MemoryMetric,
  type SystemMetrics,
  clampPercent,
  cpuBusyPercent,
  isWorkerProcess,
  parseCpuTotals,
  parseMemInfo,
  parseProcessJiffies,
  parseWorkerPatterns,
} from "./system-metrics";

/** Zugriff auf den Host — als Interface, damit Tests ohne /proc auskommen. */
export type HostSource = {
  /** Datei unterhalb des /proc-Verzeichnisses, oder `null` wenn unlesbar. */
  readText(relPath: string): Promise<string | null>;
  /** Alle PID-Verzeichnisse in /proc. */
  listPids(): Promise<number[]>;
  /** Freier/gesamter Platz des beobachteten Datenträgers. */
  diskUsage(): Promise<DiskMetric | null>;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
};

/** Eine Messung der CPU-Zähler zu einem Zeitpunkt. */
export type Sample = {
  atMs: number;
  cpu: CpuTotals | null;
  /** Summe utime+stime aller Worker-Prozesse; `null` wenn keiner sichtbar. */
  workerJiffies: number | null;
};

/**
 * Die letzte Messung dient der nächsten Anfrage als Bezugspunkt — bei
 * sekündlichem Abruf ist das genau das Ein-Sekunden-Fenster.
 */
export type SampleCache = { last: Sample | null };

/** Prozessweiter Cache der API-Route. */
export const sampleCache: SampleCache = { last: null };

/**
 * Älter darf der Bezugspunkt nicht sein. Sonst wäre der Prozentwert ein
 * Mittelwert über die ganze Pause (z.B. seit dem letzten Seitenbesuch).
 */
export const MAX_BASELINE_AGE_MS = 5_000;

/** Fehlt ein brauchbarer Bezugspunkt, wird er in dieser Spanne selbst erhoben. */
export const BOOTSTRAP_DELAY_MS = 200;

/** Kandidaten für das Host-/proc: Mount im Container, sonst das eigene /proc. */
const PROC_CANDIDATES = ["/host/proc", "/proc"];
/** Kandidaten für den beobachteten Datenträger. */
const DISK_CANDIDATES = ["/host/root", "/"];

function candidates(configured: string | undefined, fallback: string[]): string[] {
  const trimmed = (configured ?? "").trim();
  return trimmed ? [trimmed] : fallback;
}

/** CPU-Last des Hosts insgesamt, zwischen zwei Messungen. */
export function hostCpuPercent(prev: Sample, next: Sample): number | null {
  if (!prev.cpu || !next.cpu) return null;
  return cpuBusyPercent(prev.cpu, next.cpu);
}

/**
 * CPU-Last der Worker-Prozesse, ebenfalls in Prozent der GESAMTEN Host-CPU —
 * damit die beiden CPU-Kacheln direkt vergleichbar sind.
 *
 * Endet ein Prozess zwischen den Messungen, kann die Summe sinken; das wird auf
 * 0 begrenzt statt als negative Last angezeigt.
 */
export function workerCpuPercent(prev: Sample, next: Sample): number | null {
  if (!prev.cpu || !next.cpu) return null;
  if (prev.workerJiffies === null || next.workerJiffies === null) return null;
  const total = next.cpu.total - prev.cpu.total;
  if (!(total > 0)) return null;
  const busy = next.workerJiffies - prev.workerJiffies;
  return clampPercent((busy / total) * 100);
}

async function readMemory(src: HostSource): Promise<MemoryMetric | null> {
  const text = await src.readText("meminfo");
  return text ? parseMemInfo(text) : null;
}

/**
 * Summiert die CPU-Zeit aller Worker-Prozesse. `null`, wenn keiner sichtbar ist
 * — dann fehlt entweder der /proc-Mount oder die Muster passen nicht mehr, und
 * "n/v" ist ehrlicher als eine 0.
 */
async function sumWorkerJiffies(
  src: HostSource,
  patterns: string[],
): Promise<number | null> {
  const pids = await src.listPids();
  let sum = 0;
  let found = false;
  for (const pid of pids) {
    const cmdline = await src.readText(`${pid}/cmdline`);
    // Prozess inzwischen beendet oder Kernel-Thread -> überspringen.
    if (cmdline === null || !isWorkerProcess(cmdline, patterns)) continue;
    const stat = await src.readText(`${pid}/stat`);
    const jiffies = stat === null ? null : parseProcessJiffies(stat);
    if (jiffies === null) continue;
    sum += jiffies;
    found = true;
  }
  return found ? sum : null;
}

async function takeSample(
  src: HostSource,
  patterns: string[],
): Promise<Sample> {
  const stat = await src.readText("stat");
  const workerJiffies = await sumWorkerJiffies(src, patterns);
  return {
    atMs: src.nowMs(),
    cpu: stat ? parseCpuTotals(stat) : null,
    workerJiffies,
  };
}

/**
 * Erhebt alle vier Werte. Jeder ist einzeln `null`, wenn er sich nicht
 * ermitteln lässt — die übrigen Kacheln bleiben davon unberührt (req-009).
 */
export async function collectSystemMetrics(
  src: HostSource,
  cache: SampleCache,
  patterns: string[],
): Promise<SystemMetrics> {
  const [disk, memory] = await Promise.all([src.diskUsage(), readMemory(src)]);

  const now = src.nowMs();
  const cached = cache.last;
  const usable =
    cached !== null &&
    now - cached.atMs >= 0 &&
    now - cached.atMs <= MAX_BASELINE_AGE_MS;

  let baseline: Sample;
  if (usable && cached) {
    baseline = cached;
  } else {
    baseline = await takeSample(src, patterns);
    await src.sleep(BOOTSTRAP_DELAY_MS);
  }

  const current = await takeSample(src, patterns);
  cache.last = current;

  const cpu = hostCpuPercent(baseline, current);
  const workerCpu = workerCpuPercent(baseline, current);
  return {
    disk,
    cpu: cpu === null ? null : { percent: cpu },
    workerCpu: workerCpu === null ? null : { percent: workerCpu },
    memory,
  };
}

/** Erster Pfad der Liste, der lesbar ist. */
async function firstUsable(
  paths: string[],
  probe: (p: string) => string,
): Promise<string | null> {
  for (const p of paths) {
    try {
      await fsp.access(probe(p));
      return p;
    } catch {
      /* nächster Kandidat */
    }
  }
  return null;
}

/** Liest über node:fs — die Umsetzung für den laufenden Server. */
export function createNodeSource(
  procDir: string | null,
  diskPath: string | null,
): HostSource {
  return {
    async readText(relPath) {
      if (!procDir) return null;
      try {
        return await fsp.readFile(path.join(procDir, relPath), "utf8");
      } catch {
        return null;
      }
    },
    async listPids() {
      if (!procDir) return [];
      try {
        const names = await fsp.readdir(procDir);
        return names.filter((n) => /^\d+$/.test(n)).map(Number);
      } catch {
        return [];
      }
    },
    async diskUsage() {
      if (!diskPath) return null;
      try {
        const stats = await fsp.statfs(diskPath);
        const blockSize = Number(stats.bsize);
        const totalBytes = Number(stats.blocks) * blockSize;
        // bavail = für nicht-privilegierte Nutzer verfügbar, das ist der Wert,
        // den auch `df` als "Avail" zeigt.
        const freeBytes = Number(stats.bavail) * blockSize;
        if (!(totalBytes > 0) || !Number.isFinite(freeBytes)) return null;
        return {
          freeBytes: Math.min(Math.max(0, freeBytes), totalBytes),
          totalBytes,
        };
      } catch {
        return null;
      }
    },
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** Momentanwerte des Hosts für die API-Route. */
export async function readSystemMetrics(): Promise<SystemMetrics> {
  const [procDir, diskPath] = await Promise.all([
    firstUsable(candidates(process.env.HOST_PROC, PROC_CANDIDATES), (p) =>
      path.join(p, "stat"),
    ),
    firstUsable(candidates(process.env.HOST_DISK, DISK_CANDIDATES), (p) => p),
  ]);
  return collectSystemMetrics(
    createNodeSource(procDir, diskPath),
    sampleCache,
    parseWorkerPatterns(process.env.WORKER_PROCESS_MATCH),
  );
}
