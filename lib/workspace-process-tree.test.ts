import { describe, it, expect, afterEach } from "vitest";
import {
  CLEANUP_SIGNALS,
  TREE_KILL_GRACE_MS,
  installProcessTreeCleanup,
  killAllProcessTrees,
  liveProcessTreeCount,
  run,
} from "./workspace";

// bug-023: Ein vorzeitig beendeter Lauf liess seine ENKEL weiterlaufen. `npm
// test` startet vitest, vitest startet seinen Worker-Pool; ein Kill an `npm`
// erwischte nur npm. Am 26.09. hielt der Container so 4,7 GB mit vier
// vitest-Prozessen, die sechs Tage zuvor gestartet waren — bis der OOM-Killer auf
// demselben Rechner einen fremden Prod-Deploy samt Runner-Dienst traf.
//
// Gemessen wird das hier an echten Prozessen: Der Bug steckte genau in dem, was
// `spawn` und die Signale tun, und eine Naht davor haette ihn nicht gezeigt.
// Statt `sh` treibt node selbst die Kinder — der Worker-Container bringt keine
// Shell mit (bug-016), node ist dagegen immer da.

const NODE = process.execPath;

/** Prozesse, die ein Test angelegt hat — am Ende hinterlaesst keiner etwas. */
const spawnedPids: number[] = [];

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* schon weg — der Normalfall */
    }
  }
});

/** Laeuft dieser Prozess noch? Signal 0 fragt nur, ohne etwas zu schicken. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Warten, bis `pid` verschwunden ist — oder aufgeben und false melden. */
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await sleep(20);
  }
  return !alive(pid);
}

/**
 * Ein Kind, das ein Enkelkind startet und dessen PID auf stdout meldet. Genau
 * die Aufstellung des Bugs: Der Enkel haelt sich fuer sich und ueberlebt jeden
 * Kill, der nur das Kind meint.
 *
 * `hold` entscheidet, ob der Enkel die Ausgabe-Pipe des Laufs mit-erbt — der
 * zweite Teil des Bugs, denn ein offener Strom haelt `close` zurueck.
 * `childExits` laesst das Kind sofort sauber enden, waehrend der Enkel bleibt.
 */
function grandchildScript(
  opts: { hold?: boolean; childExits?: boolean; ignoreTerm?: boolean } = {},
): string {
  const stdio = opts.hold ? '"inherit"' : '"ignore"';
  const grandchild = opts.ignoreTerm
    ? 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'
    : "setInterval(() => {}, 1000);"; // haengt, bis jemand ihn beendet
  return [
    'const { spawn } = require("node:child_process");',
    `const kid = spawn(process.argv[0], ["-e", ${JSON.stringify(grandchild)}], { stdio: ${stdio} });`,
    'process.stdout.write("ENKEL " + kid.pid + "\\n");',
    opts.childExits
      ? // Kurz warten, damit die Meldung draussen ist, dann sauber enden.
        "setTimeout(() => process.exit(0), 100);"
      : "setInterval(() => {}, 1000);",
  ].join("\n");
}

/** Die vom Kind gemeldete Enkel-PID. */
function grandchildPid(stdout: string): number {
  const m = stdout.match(/ENKEL (\d+)/);
  expect(m, `keine Enkel-PID in: ${stdout}`).toBeTruthy();
  const pid = Number(m![1]);
  spawnedPids.push(pid);
  return pid;
}

describe("Ein Lauf nimmt seinen ganzen Prozessbaum mit (bug-023)", () => {
  it("AC: ein Timeout beendet auch die Enkelprozesse, nicht nur das Kind", async () => {
    const res = await run(NODE, ["-e", grandchildScript()], {
      timeoutMs: 300,
      killGraceMs: 500,
    });

    expect(res.code).toBe(124);
    expect(res.stderr).toContain("[timeout]");
    const enkel = grandchildPid(res.stdout);
    expect(await goneWithin(enkel, 3000)).toBe(true);
  });

  it("AC: ein Enkel, der das Kind ueberlebt, laeuft nach dem Lauf nicht weiter", async () => {
    // Kein Timeout, kein Abbruch: das Kind endet mit 0 und laesst den Enkel
    // stehen. Genau so behielt der Container seinen Speicher, ohne dass ein
    // Lauf gescheitert war.
    const res = await run(NODE, ["-e", grandchildScript({ childExits: true })], {
      killGraceMs: 500,
    });

    expect(res.ok).toBe(true);
    const enkel = grandchildPid(res.stdout);
    expect(await goneWithin(enkel, 3000)).toBe(true);
  });

  it("AC: ein Enkel, der sich nicht beenden laesst, wird hart beendet", async () => {
    const res = await run(
      NODE,
      ["-e", grandchildScript({ ignoreTerm: true, hold: true })],
      { timeoutMs: 300, killGraceMs: 500 },
    );

    expect(res.code).toBe(124);
    const enkel = grandchildPid(res.stdout);
    expect(await goneWithin(enkel, 3000)).toBe(true);
  });

  it("ein Enkel, der die Ausgabe-Pipe haelt, haengt den Aufruf nicht auf", async () => {
    // Das Kind ist fertig, der Enkel hat stdout geerbt — "close" kommt deshalb
    // nie. Der Aufruf muss trotzdem antworten, und zwar mit dem Exit-Code des
    // Kindes, nicht als Timeout.
    const started = Date.now();
    const res = await run(
      NODE,
      ["-e", grandchildScript({ hold: true, childExits: true })],
      { killGraceMs: 400 },
    );

    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    const enkel = grandchildPid(res.stdout);
    expect(await goneWithin(enkel, 3000)).toBe(true);
  });

  it("der Aufruf laeuft in einer eigenen Prozessgruppe", async () => {
    // Die Gruppe ist die Voraussetzung fuer alles oben: nur weil die PID des
    // Kindes zugleich Gruppen-ID ist, erwischt ein Signal an -PID den Enkel mit.
    let stdout = "";
    const pending = run(
      NODE,
      ["-e", 'process.stdout.write("PID " + process.pid + "\\n"); setInterval(() => {}, 1000);'],
      { killGraceMs: 500, onData: (chunk) => (stdout += chunk) },
    );
    const until = Date.now() + 5000;
    while (!/PID \d+/.test(stdout) && Date.now() < until) await sleep(20);
    const pid = Number(stdout.match(/PID (\d+)/)![1]);
    spawnedPids.push(pid);

    // Es gibt eine Prozessgruppe mit dieser ID, das Kind fuehrt sie also an.
    // Ein Kind in unserer eigenen Gruppe wuerde hier ESRCH werfen.
    expect(() => process.kill(-pid, 0)).not.toThrow();

    killAllProcessTrees();
    await pending;
    expect(await goneWithin(pid, 3000)).toBe(true);
  });

  it("ein normaler Lauf bleibt ein normaler Lauf", async () => {
    const res = await run(NODE, ["-e", 'process.stdout.write("hallo")']);
    expect(res).toMatchObject({ ok: true, code: 0, stdout: "hallo" });

    const failed = await run(NODE, ["-e", "process.exit(3)"]);
    expect(failed).toMatchObject({ ok: false, code: 3 });

    const missing = await run("kein-solches-programm-appbaua", []);
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe(127);
  });

  it("nach jedem Lauf ist keine Prozessgruppe mehr vermerkt", async () => {
    await run(NODE, ["-e", 'process.stdout.write("x")']);
    expect(liveProcessTreeCount()).toBe(0);
  });
});

describe("Ein abgebrochener Worker nimmt seine Laeufe mit (bug-023)", () => {
  it("AC: killAllProcessTrees beendet Kind und Enkel eines laufenden Aufrufs", async () => {
    let stdout = "";
    const pending = run(NODE, ["-e", grandchildScript({ hold: true })], {
      killGraceMs: 500,
      onData: (chunk) => {
        stdout += chunk;
      },
    });

    // Warten, bis der Enkel gemeldet ist — vorher gibt es nichts zu beenden.
    const until = Date.now() + 5000;
    while (!/ENKEL \d+/.test(stdout) && Date.now() < until) await sleep(20);
    const enkel = grandchildPid(stdout);
    expect(liveProcessTreeCount()).toBe(1);

    expect(killAllProcessTrees()).toBe(1);

    const res = await pending;
    expect(res.ok).toBe(false);
    expect(await goneWithin(enkel, 3000)).toBe(true);
    expect(liveProcessTreeCount()).toBe(0);
  });

  it("verdrahtet Ende und Abbruch-Signale des Prozesses genau einmal", () => {
    const events: string[] = [];
    let exited: number | undefined;
    const target = {
      on(event: string, listener: () => void) {
        events.push(event);
        listener();
        return this;
      },
      exit(code?: number) {
        exited = code;
      },
    };

    expect(installProcessTreeCleanup(target)).toBe(true);
    expect(events).toEqual(["exit", ...CLEANUP_SIGNALS]);
    // Ein eigener Signal-Listener ersetzt das Standardverhalten, also muss das
    // Beenden nachgeholt werden — sonst laeuft ein Worker nach SIGTERM weiter.
    expect(exited).toBe(0);

    // Zweimal registrieren wuerde nur Listener stapeln.
    events.length = 0;
    expect(installProcessTreeCleanup(target)).toBe(false);
    expect(events).toEqual([]);
  });

  it("die Frist fuers harte Beenden ist gesetzt", () => {
    expect(TREE_KILL_GRACE_MS).toBeGreaterThan(0);
  });
});
