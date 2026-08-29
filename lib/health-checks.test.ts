import { describe, it, expect, vi } from "vitest";
import type { DockerClient, ExecResult } from "./docker";
import type {
  AppHealth,
  CheckKind,
  CheckResult,
  DockerContainer,
} from "./health";
import type { Repo } from "./repos";
import {
  type CheckDeps,
  extractTimestamp,
  isDue,
  parseTableColumn,
  roundIsDue,
  runRound,
} from "./health-checks";
import { DEFAULT_HEALTH_SETTINGS, type HealthSettings } from "./health-settings";

// Die Akzeptanzkriterien von req-032, so weit sie an den Prüfungen hängen.
// Nichts hier fasst Docker, das Netz oder einen KI-Anbieter an — alles kommt
// über CheckDeps herein.

const NOW = new Date("2026-08-29T12:00:00.000Z");

const lgt: Repo = {
  id: "r1",
  name: "LivingGardenTwin",
  url: "github.com/kruianer/livinggardentwin",
  active: true,
  model: "sonnet",
  monitored: true,
};

const HEALTH_MD = `# Health-Checks

## Datenbank

- Container: \`lgt-prod-db\`
- Datenbank: \`livinggarden\`
- Benutzer: \`lgt\`

## Web

- prod: \`https://livinggarden.example\` erwartet \`200\`

## Datenfluss

- Beschreibung: Zigbee-Sensorwerte
- Woran erkennbar: Tabelle \`sensor_readings\`, Spalte \`recorded_at\`
- Zu alt ab: 30 Minuten

## KI-Anbieter

- Anbieter: openai
- Schluessel aus: \`OPENAI_API_KEY\`
`;

function container(over: Partial<DockerContainer> = {}): DockerContainer {
  const name = over.name ?? "lgt-prod-app";
  return {
    id: name, // im Test ist der Name die id — das macht Zusicherungen lesbar
    name,
    state: "running",
    status: "Up 3 hours",
    project: "lgt-prod",
    ...over,
  };
}

const RUNNING = [
  container({ name: "lgt-prod-app" }),
  container({ name: "lgt-prod-db" }),
  container({ name: "lgt-prod-monitoring-watchdog" }),
];

type DockerStub = DockerClient & {
  restarts: string[];
  execs: string[][];
};

function dockerStub(
  containers: DockerContainer[],
  over: Partial<{
    exec: (id: string, cmd: string[]) => Promise<ExecResult>;
    env: (id: string, name: string) => Promise<string | null>;
  }> = {},
): DockerStub {
  const restarts: string[] = [];
  const execs: string[][] = [];
  return {
    restarts,
    execs,
    async list() {
      return containers;
    },
    async env(id, name) {
      return over.env ? over.env(id, name) : "sk-test";
    },
    async exec(id, cmd) {
      execs.push(cmd);
      if (over.exec) return over.exec(id, cmd);
      // Vorgabe: pg_isready antwortet, und der jüngste Messwert ist frisch.
      return cmd[0] === "psql"
        ? { exitCode: 0, output: new Date(NOW.getTime() - 5 * 60_000).toISOString() }
        : { exitCode: 0, output: "" };
    },
    async restart(id) {
      restarts.push(id);
    },
  };
}

function deps(over: Partial<CheckDeps> = {}): CheckDeps & { docker: DockerStub } {
  const docker = (over.docker as DockerStub) ?? dockerStub(RUNNING);
  const base: Omit<CheckDeps, "docker"> = {
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    })) as unknown as typeof fetch,
    readHealthMd: async () => HEALTH_MD,
    now: () => NOW,
  };
  return { ...base, ...over, docker };
}

function settings(over: Partial<HealthSettings> = {}): HealthSettings {
  return {
    ...DEFAULT_HEALTH_SETTINGS,
    ...over,
    checks: { ...DEFAULT_HEALTH_SETTINGS.checks, ...(over.checks ?? {}) },
  };
}

const checkOf = (app: AppHealth, kind: CheckKind): CheckResult =>
  app.checks.find((c) => c.kind === kind)!;

describe("req-032 — Container-Prüfung", () => {
  it("AC: ein Container in der Neustart-Schleife macht die Prüfung rot und nennt ihn", async () => {
    const docker = dockerStub([
      container({ name: "lgt-prod-app" }),
      container({ name: "lgt-prod-db" }),
      container({
        name: "lgt-prod-monitoring-watchdog",
        state: "restarting",
        status: "Restarting (1) 5 seconds ago",
      }),
    ]);
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));

    const check = checkOf(app, "container");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("lgt-prod-monitoring-watchdog");
    expect(check.detail).toContain("Neustart-Schleife");
    expect(app.lamp).toBe("red");
  });

  it("AC: laufen alle Container und bestehen die Prüfungen, ist die Ampel grün", async () => {
    const docker = dockerStub(RUNNING);
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    // Alle Container laufen, pg_isready endet mit 0, die Webadresse antwortet
    // mit 200 und der jüngste Messwert ist 5 Minuten alt.
    expect(app.checks.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(app.lamp).toBe("green");
  });

  it("nennt die Container der App mitsamt ihrem Zustand, für den Neustart-Knopf", async () => {
    const docker = dockerStub([
      container({ name: "lgt-prod-app", state: "exited", status: "Exited (1)" }),
      container({ name: "lgt-prod-db" }),
    ]);
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    const names = checkOf(app, "container").containers?.map((c) => c.name);
    expect(names).toEqual(["lgt-prod-app", "lgt-prod-db"]);
    expect(
      checkOf(app, "container").containers?.find((c) => c.name === "lgt-prod-app")
        ?.failing,
    ).toBe(true);
  });

  it("ohne Docker ist die Prüfung unbekannt, nicht rot", async () => {
    const docker = dockerStub([]);
    docker.list = async () => {
      throw new Error("kein Socket");
    };
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    // Eine Prüfung, die nicht laufen konnte, hat nichts gefunden — sie darf
    // deshalb nicht rot werden.
    for (const kind of (["container", "database", "zigbee"] as CheckKind[])) {
      expect(checkOf(app, kind).status).toBe("unknown");
    }
    expect(app.lamp).not.toBe("red");
  });
});

describe("req-032 — Repo ohne health.md", () => {
  it("AC: es läuft nur die Container-Prüfung, die übrigen sind 'nicht konfiguriert'", async () => {
    const docker = dockerStub(RUNNING);
    const [app] = await runRound(
      [lgt],
      [],
      settings(),
      deps({ docker, readHealthMd: async () => null }),
    );

    expect(checkOf(app, "container").status).toBe("ok");
    for (const kind of (["database", "web", "zigbee", "ai"] as CheckKind[])) {
      expect(checkOf(app, kind).status).toBe("unconfigured");
    }
    // Nicht konfiguriert ist kein Befund — die Ampel bleibt grün.
    expect(app.lamp).toBe("green");
  });

  it("es wird nichts angefragt, was nicht beschrieben ist", async () => {
    const fetchImpl = vi.fn();
    const docker = dockerStub(RUNNING);
    await runRound(
      [lgt],
      [],
      settings(),
      deps({
        docker,
        readHealthMd: async () => null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(docker.execs).toEqual([]);
  });
});

describe("req-032 — Datenfluss (Zigbee)", () => {
  it("AC: Frist 30 Minuten, jüngster Wert 45 Minuten alt -> rot", async () => {
    const stale = new Date(NOW.getTime() - 45 * 60_000).toISOString();
    const docker = dockerStub(RUNNING, {
      exec: async (_id, cmd) =>
        cmd[0] === "psql"
          ? { exitCode: 0, output: stale }
          : { exitCode: 0, output: "" },
    });
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));

    const check = checkOf(app, "zigbee");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("45 min alt");
    expect(check.detail).toContain("30 min");
    expect(app.lamp).toBe("red");
  });

  it("ein Wert innerhalb der Frist ist grün", async () => {
    const fresh = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const docker = dockerStub(RUNNING, {
      exec: async (_id, cmd) =>
        cmd[0] === "psql"
          ? { exitCode: 0, output: fresh }
          : { exitCode: 0, output: "" },
    });
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    expect(checkOf(app, "zigbee").status).toBe("ok");
  });

  it("fragt die Datenbank der App über ihren eigenen Container ab", async () => {
    const docker = dockerStub(RUNNING);
    await runRound([lgt], [], settings(), deps({ docker }));
    const psql = docker.execs.find((c) => c[0] === "psql");
    expect(psql).toBeDefined();
    expect(psql!.join(" ")).toContain("SELECT MAX(recorded_at) FROM sensor_readings");
  });
});

describe("req-032 — Datenbank-Prüfung", () => {
  it("pg_isready mit Code 0 ist grün", async () => {
    const docker = dockerStub(RUNNING);
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    expect(checkOf(app, "database").status).toBe("ok");
    expect(docker.execs.some((c) => c[0] === "pg_isready")).toBe(true);
  });

  it("eine hängende Datenbank ist rot, auch wenn ihr Container läuft", async () => {
    const docker = dockerStub(RUNNING, {
      exec: async (_id, cmd) =>
        cmd[0] === "pg_isready"
          ? { exitCode: 2, output: "no response" }
          : { exitCode: 0, output: new Date(NOW).toISOString() },
    });
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    expect(checkOf(app, "container").status).toBe("ok");
    expect(checkOf(app, "database").status).toBe("fail");
    expect(app.lamp).toBe("red");
  });
});

describe("req-032 — Web-Prüfung", () => {
  it("der erwartete Status ist grün", async () => {
    const docker = dockerStub(RUNNING);
    const [app] = await runRound(
      [lgt],
      [],
      settings(),
      deps({
        docker,
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch,
      }),
    );
    expect(checkOf(app, "web").status).toBe("ok");
    expect(checkOf(app, "web").detail).toContain("prod: 200");
  });

  it("keine Antwort ist rot", async () => {
    const docker = dockerStub(RUNNING);
    const [app] = await runRound(
      [lgt],
      [],
      settings(),
      deps({
        docker,
        fetchImpl: (async (url: string) => {
          if (String(url).startsWith("https://livinggarden"))
            throw new Error("ECONNREFUSED");
          return { ok: true, status: 200, text: async () => "" };
        }) as unknown as typeof fetch,
      }),
    );
    expect(checkOf(app, "web").status).toBe("fail");
    expect(checkOf(app, "web").detail).toContain("keine Antwort");
  });
});

describe("req-032 — KI-Prüfung", () => {
  it("AC: abgeschaltet wird KEIN Aufruf an den KI-Anbieter gemacht", async () => {
    const calls: string[] = [];
    const docker = dockerStub(RUNNING);
    const [app] = await runRound(
      [lgt],
      [],
      settings({ checks: { ...DEFAULT_HEALTH_SETTINGS.checks, ai: false } }),
      deps({
        docker,
        fetchImpl: (async (url: string) => {
          calls.push(String(url));
          return { ok: true, status: 200, text: async () => "" };
        }) as unknown as typeof fetch,
      }),
    );

    expect(calls.some((u) => u.includes("openai.com"))).toBe(false);
    expect(checkOf(app, "ai").status).toBe("off");
  });

  it("eingeschaltet fragt sie den Anbieter mit dem Schlüssel der App", async () => {
    const calls: { url: string; auth: string }[] = [];
    const docker = dockerStub(RUNNING, {
      env: async (_id, name) => (name === "OPENAI_API_KEY" ? "sk-der-app" : null),
    });
    await runRound(
      [lgt],
      [],
      settings(),
      deps({
        docker,
        fetchImpl: (async (url: string, init?: RequestInit) => {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          calls.push({ url: String(url), auth: headers.Authorization ?? "" });
          return { ok: true, status: 200, text: async () => "" };
        }) as unknown as typeof fetch,
      }),
    );
    const openai = calls.find((c) => c.url.includes("openai.com"));
    expect(openai).toBeDefined();
    expect(openai!.auth).toBe("Bearer sk-der-app");
  });

  it("ohne auffindbaren Schlüssel bleibt sie unbekannt statt rot", async () => {
    const docker = dockerStub(RUNNING, { env: async () => null });
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    expect(checkOf(app, "ai").status).toBe("unknown");
    expect(checkOf(app, "ai").detail).toContain("OPENAI_API_KEY");
  });
});

describe("req-032 — nichts läuft von selbst", () => {
  it("AC: steht eine Prüfung auf Rot, startet die Prüfrunde NICHTS neu", async () => {
    const docker = dockerStub([
      container({ name: "lgt-prod-app", state: "exited", status: "Exited (1)" }),
      container({ name: "lgt-prod-db", state: "exited", status: "Exited (1)" }),
    ]);
    const [app] = await runRound([lgt], [], settings(), deps({ docker }));
    expect(app.lamp).toBe("red");
    expect(docker.restarts).toEqual([]);
  });
});

describe("req-032 — nur überwachte Repos", () => {
  it("AC: ein Repo mit ausgeschaltetem Schalter wird nicht geprüft", async () => {
    const docker = dockerStub(RUNNING);
    const results = await runRound(
      [{ ...lgt, monitored: false }],
      [],
      settings(),
      deps({ docker }),
    );
    expect(results).toEqual([]);
  });

  it("AC: für den Worker deaktiviert, aber überwacht -> wird trotzdem geprüft", async () => {
    const docker = dockerStub(RUNNING);
    const results = await runRound(
      [{ ...lgt, active: false, monitored: true }],
      [],
      settings(),
      deps({ docker }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].repoName).toBe("LivingGardenTwin");
  });
});

describe("Prüfabstände", () => {
  const at = (minutesAgo: number) =>
    new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

  it("eine nie gelaufene Prüfung ist fällig", () => {
    expect(isDue(undefined, "container", settings(), NOW)).toBe(true);
  });

  it("innerhalb des Abstands ist sie es nicht", () => {
    const prev = { kind: "container" as const, status: "ok" as const, detail: "", checkedAt: at(2) };
    expect(isDue(prev, "container", settings({ intervalMinutes: 5 }), NOW)).toBe(false);
  });

  it("nach dem Abstand wieder schon", () => {
    const prev = { kind: "container" as const, status: "ok" as const, detail: "", checkedAt: at(6) };
    expect(isDue(prev, "container", settings({ intervalMinutes: 5 }), NOW)).toBe(true);
  });

  it("die KI-Prüfung folgt ihrem eigenen, längeren Abstand", () => {
    const prev = { kind: "ai" as const, status: "ok" as const, detail: "", checkedAt: at(60) };
    // Eine Stunde alt: für die laufenden Prüfungen längst fällig …
    expect(isDue({ ...prev, kind: "web" }, "web", settings(), NOW)).toBe(true);
    // … für die KI-Prüfung mit 24 Stunden Abstand noch lange nicht.
    expect(isDue(prev, "ai", settings(), NOW)).toBe(false);
  });

  it("eine nicht fällige Prüfart wird nicht erneut ausgeführt", async () => {
    const docker = dockerStub(RUNNING);
    const first = await runRound([lgt], [], settings(), deps({ docker }));
    const execsAfterFirst = docker.execs.length;

    // Zweite Runde eine Minute später: der Abstand ist 5 Minuten.
    const later = new Date(NOW.getTime() + 60_000);
    const second = await runRound(
      [lgt],
      first,
      settings(),
      deps({ docker, now: () => later }),
    );
    expect(docker.execs.length).toBe(execsAfterFirst);
    expect(checkOf(second[0], "container").checkedAt).toBe(
      checkOf(first[0], "container").checkedAt,
    );
  });

  it("roundIsDue meldet nichts zu tun, solange alles frisch ist", async () => {
    const docker = dockerStub(RUNNING);
    const first = await runRound([lgt], [], settings(), deps({ docker }));
    expect(roundIsDue([lgt], first, settings(), NOW)).toBe(false);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    expect(roundIsDue([lgt], first, settings(), later)).toBe(true);
  });
});

describe("Hilfsfunktionen", () => {
  it("extractTimestamp liest den ersten ISO-Zeitstempel", () => {
    expect(extractTimestamp("2026-08-29 11:30:00")?.toISOString()).toBe(
      new Date("2026-08-29T11:30:00").toISOString(),
    );
    expect(extractTimestamp("kein Datum")).toBeNull();
  });

  it("parseTableColumn versteht beide Schreibweisen", () => {
    expect(parseTableColumn("Tabelle `readings`, Spalte `at`")).toEqual({
      table: "readings",
      column: "at",
    });
    expect(parseTableColumn("readings.at")).toEqual({ table: "readings", column: "at" });
    expect(parseTableColumn("irgendwas")).toBeNull();
  });
});
