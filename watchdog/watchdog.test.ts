// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// Der Ausfallwächter (req-034) — die Datei, die beim Webhoster liegt.
//
// Die Verhaltensfälle fahren echtes PHP: `heartbeat.php` über den eingebauten
// Webserver (nur so sind 403 und 200 überhaupt beobachtbar), `check.php` als
// CLI-Skript, so wie der Cronjob des Hosters es aufruft. Telegram ist dabei ein
// Stub im Testprozess, der mitschreibt, was hinausgehen würde.
//
// Vergehende Zeit wird nicht simuliert, sondern in der Zustandsdatei gesetzt:
// der Wächter merkt sich genau dort, wann der letzte Herzschlag ankam, und eine
// Datei mit einem 16 Minuten alten Zeitpunkt IST der Fall "Rechner seit 16
// Minuten aus".
//
// Ohne installiertes PHP entfallen diese Fälle (der Hoster hat es, dieser
// Rechner nicht unbedingt). Was auch ohne PHP prüfbar ist — die 15-Minuten-
// Frist, der zeitkonstante Vergleich der Kennung, die Ablage der Geheimnisse
// außerhalb des Web-Verzeichnisses — steht darunter und läuft immer.

const ROOT = path.join(process.cwd(), "watchdog");
const TOKEN = "kennung-des-herzschlags";
const TIMEOUT_SECONDS = 15 * 60;

function hasPhp(): boolean {
  try {
    return spawnSync("php", ["-v"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

const PHP = hasPhp();

// ---------------------------------------------------------------------------
// Fälle mit echtem PHP
// ---------------------------------------------------------------------------

describe.skipIf(!PHP)("Ausfallwächter, mit echtem PHP gefahren (req-034)", () => {
  let telegram: Server;
  let php: ChildProcess;
  let baseUrl: string;
  let privateDir: string;
  let stateFile: string;
  /** Was an Telegram ginge. */
  let messages: string[];
  /** Auf true schaltet den Telegram-Stub auf "nicht erreichbar". */
  let telegramBroken = false;

  const listen = (server: Server): Promise<number> =>
    new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () =>
        resolve((server.address() as AddressInfo).port),
      );
    });

  beforeAll(async () => {
    telegram = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (telegramBroken) {
          res.writeHead(500).end("nope");
          return;
        }
        messages.push(JSON.parse(body).text);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const telegramPort = await listen(telegram);

    privateDir = mkdtempSync(path.join(tmpdir(), "watchdog-"));
    stateFile = path.join(privateDir, "state.json");
    // Die watchdog.php liegt beim Hoster neben der config.php — hier also im
    // selben temporären Verzeichnis.
    writeFileSync(
      path.join(privateDir, "watchdog.php"),
      readFileSync(path.join(ROOT, "private", "watchdog.php"), "utf8"),
    );
    writeFileSync(
      path.join(privateDir, "config.php"),
      `<?php return array(
        'bot_token' => '123:ABC',
        'chat_id' => '4711',
        'token' => '${TOKEN}',
        'api_base' => 'http://127.0.0.1:${telegramPort}',
        'label' => 'appbaua dev',
      );`,
    );

    const appPort = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    baseUrl = `http://127.0.0.1:${appPort}`;
    php = spawn(
      "php",
      ["-d", "opcache.enable=0", "-S", `127.0.0.1:${appPort}`, "-t", process.cwd()],
      { env: { ...process.env, WATCHDOG_PRIVATE: privateDir }, stdio: "ignore" },
    );

    // Warten, bis der eingebaute Webserver Anfragen annimmt.
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`${baseUrl}/watchdog/public/heartbeat.php`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error("php -S ist nicht hochgekommen");
  }, 20_000);

  afterAll(() => {
    php?.kill();
    telegram?.close();
    if (privateDir) rmSync(privateDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    messages = [];
    telegramBroken = false;
    rmSync(stateFile, { force: true });
  });

  const now = () => Math.floor(Date.now() / 1000);

  function writeState(state: {
    lastBeatAt: number | null;
    alerted?: boolean;
    downFrom?: number | null;
  }) {
    writeFileSync(
      stateFile,
      JSON.stringify({
        lastBeatAt: state.lastBeatAt,
        alerted: state.alerted ?? false,
        downFrom: state.downFrom ?? null,
      }),
    );
  }

  function readState() {
    return JSON.parse(readFileSync(stateFile, "utf8")) as {
      lastBeatAt: number | null;
      alerted: boolean;
      downFrom: number | null;
    };
  }

  /** Ein Herzschlag, so wie appbaua ihn schickt. */
  function beat(token: string | null = TOKEN) {
    return fetch(`${baseUrl}/watchdog/public/heartbeat.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token === null ? {} : { "X-Watchdog-Token": token }),
      },
      body: JSON.stringify({ at: new Date().toISOString() }),
    });
  }

  /**
   * Die Nachschau, so wie der Cronjob des Hosters sie anstößt: als CLI-Skript.
   *
   * Bewusst asynchron gestartet — der Telegram-Stub läuft im selben Prozess wie
   * dieser Test, und ein blockierendes spawnSync würde ihn daran hindern, dem
   * PHP zu antworten.
   */
  function check(): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("php", [path.join(ROOT, "public", "check.php")], {
        env: { ...process.env, WATCHDOG_PRIVATE: privateDir },
      });
      let out = "";
      let err = "";
      proc.stdout.on("data", (c) => (out += c));
      proc.stderr.on("data", (c) => (err += c));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(`check.php: ${code} ${err}`)),
      );
    });
  }

  it("nimmt einen Herzschlag an und merkt sich den Zeitpunkt", async () => {
    const res = await beat();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; at: string };
    expect(body.ok).toBe(true);
    // Der bestätigte Zeitpunkt — genau den zeigt appbaua auf der Zustandsseite.
    expect(Math.abs(new Date(body.at).getTime() / 1000 - now())).toBeLessThan(5);
    expect(readState().lastBeatAt).toBeGreaterThan(now() - 5);
    expect(messages).toEqual([]);
  });

  it("AC: ohne gültige Kennung wird abgewiesen und NICHT als Herzschlag gewertet", async () => {
    writeState({ lastBeatAt: now() - 20 * 60 });

    for (const token of [null, "", "falsch"]) {
      const res = await beat(token);
      expect(res.status).toBe(403);
    }
    // Der alte Zeitpunkt steht unverändert: sonst könnte jeder, der die Adresse
    // kennt, den Ausfall des Rechners vertuschen.
    expect(readState().lastBeatAt).toBeLessThan(now() - 19 * 60);
    expect(messages).toEqual([]);
  });

  it("AC: nach 15 Minuten ohne Herzschlag kommt eine Nachricht, die den Rechner benennt", async () => {
    writeState({ lastBeatAt: now() - (TIMEOUT_SECONDS + 60) });

    expect(await check()).toBe("gemeldet");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Rechner meldet sich nicht");
    expect(messages[0]).toContain("16 Minuten");
    // Klar unterscheidbar vom gewöhnlichen App-Ausfall aus req-033.
    expect(messages[0]).toContain("NICHT der Ausfall einer einzelnen App");
    expect(messages[0]).toContain("appbaua dev");
    expect(readState().alerted).toBe(true);
  });

  it("AC: ein anhaltender Ausfall erzeugt KEINE weitere Nachricht", async () => {
    writeState({ lastBeatAt: now() - 20 * 60 });
    expect(await check()).toBe("gemeldet");

    // Stunden später, immer noch aus.
    writeState({ lastBeatAt: now() - 5 * 60 * 60, alerted: true, downFrom: now() - 5 * 60 * 60 });
    expect(await check()).toBe("still");
    expect(await check()).toBe("still");
    expect(messages).toHaveLength(1);
  });

  it("AC: kommt der Herzschlag wieder, folgt die Entwarnung mit der Dauer", async () => {
    const downFrom = now() - 42 * 60;
    writeState({ lastBeatAt: downFrom, alerted: true, downFrom });

    const res = await beat();
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("wieder da");
    expect(messages[0]).toContain("42 Minuten");
    expect(readState().alerted).toBe(false);
  });

  it("AC: ein Neustart von 3 Minuten löst KEINE Nachricht aus", async () => {
    // Vor dem Deploy ein Herzschlag …
    writeState({ lastBeatAt: now() - 3 * 60 });
    expect(await check()).toBe("still");

    // … und nach 3 Minuten ist appbaua wieder da und schlägt weiter.
    await beat();
    expect(await check()).toBe("still");
    expect(messages).toEqual([]);
  });

  it("ein nicht erreichbares Telegram verschluckt den Ausfall nicht", async () => {
    writeState({ lastBeatAt: now() - 20 * 60 });
    telegramBroken = true;
    expect(await check()).toBe("Versand fehlgeschlagen");
    // Nicht als gemeldet vermerkt — sonst bliebe es für immer still.
    expect(readState().alerted).toBe(false);

    telegramBroken = false;
    expect(await check()).toBe("gemeldet");
    expect(messages).toHaveLength(1);
  });

  it("hat der Wächter noch nie einen Herzschlag gesehen, meldet er nichts", async () => {
    expect(existsSync(stateFile)).toBe(false);
    expect(await check()).toBe("still");
    expect(messages).toEqual([]);
  });

  it("über HTTP braucht auch die Nachschau die Kennung", async () => {
    writeState({ lastBeatAt: now() - 20 * 60 });
    const res = await fetch(`${baseUrl}/watchdog/public/check.php`);
    expect(res.status).toBe(403);
    expect(messages).toEqual([]);

    const ok = await fetch(`${baseUrl}/watchdog/public/check.php?token=${TOKEN}`);
    expect(ok.status).toBe(200);
    expect(messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Was auch ohne PHP gilt
// ---------------------------------------------------------------------------

const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("Der Wächter als Quelltext (req-034)", () => {
  it("wartet 15 Minuten, bevor er meldet", () => {
    expect(source("private/watchdog.php")).toContain(
      "define('WATCHDOG_TIMEOUT_SECONDS', 15 * 60)",
    );
  });

  it("vergleicht die Kennung zeitkonstant", () => {
    // Ein "===" würde über seine Laufzeit verraten, wie viele Zeichen stimmen.
    expect(source("private/watchdog.php")).toContain("hash_equals(");
  });

  it("holt die Geheimnisse von außerhalb des Web-Verzeichnisses", () => {
    for (const file of ["public/heartbeat.php", "public/check.php"]) {
      const php = source(file);
      // Zwei Ebenen hoch: das öffentliche Verzeichnis liegt unterhalb der
      // Konto-Wurzel, die config.php daneben.
      expect(php).toContain("dirname(__DIR__, 2) . '/watchdog-private'");
      expect(php).toContain("watchdog_load_config($private)");
    }
  });

  it("hat keine echten Zugangsdaten im Repo", () => {
    const sample = source("private/config.sample.php");
    expect(sample).toContain("HIER-DER-BOT-SCHLUESSEL");
    // Die ausgefüllte config.php entsteht erst beim Hoster.
    expect(existsSync(path.join(ROOT, "private", "config.php"))).toBe(false);
  });

  it("beantwortet einen abgewiesenen Aufruf ohne Auskunft über den Grund", () => {
    // Diese Antwort ist öffentlich lesbar; sie sagt nur "nein".
    expect(source("public/heartbeat.php")).toContain(
      "watchdog_respond(403, array('ok' => false))",
    );
  });
});
