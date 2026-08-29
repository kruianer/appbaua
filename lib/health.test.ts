import { describe, it, expect } from "vitest";
import {
  type DockerContainer,
  CHECK_KINDS,
  EMPTY_SPEC,
  appTokens,
  foldKey,
  isContainerFailing,
  isRestartLoop,
  lampFor,
  matchContainers,
  newestCheckedAt,
  parseDurationMinutes,
  parseHealthMd,
  pendingHealth,
  statusMatches,
} from "./health";

// req-032: was in der health.md eines Repos steht, und was appbaua daraus
// ableitet. Die Datei ist ein Maschinen-Vertrag — dieser Test hält fest, wie er
// gelesen wird.

/** Die Vorlage des Skills `setup-health`, ausgefüllt für LivingGardenTwin. */
const HEALTH_MD = `# Health-Checks

Woran man erkennt, dass diese App funktioniert.

## Datenbank

- Container: \`lgt-prod-db\`
- Datenbank: \`livinggarden\`
- Benutzer: \`lgt\`

## Web

- dev: \`https://dev.livinggarden.example\` erwartet \`307\`
- prod: \`https://livinggarden.example\` erwartet \`200, 307\`

## Datenfluss

- Beschreibung: Zigbee-Sensorwerte aus dem Gewächshaus
- Woran erkennbar: Tabelle \`sensor_readings\`, Spalte \`recorded_at\`
- Zu alt ab: 30 Minuten

## KI-Anbieter

- Anbieter: openai
- Schluessel aus: \`OPENAI_API_KEY\`

## Nicht pruefen

- \`lgt-prod-backup\` — läuft nur nachts
`;

function container(over: Partial<DockerContainer> = {}): DockerContainer {
  return {
    id: "c1",
    name: "lgt-prod-app",
    state: "running",
    status: "Up 3 hours",
    project: "lgt-prod",
    ...over,
  };
}

describe("foldKey — Überschriften und Schlüssel treffen sich", () => {
  it("schreibt Umlaute aus und wirft alles andere weg", () => {
    expect(foldKey("Nicht prüfen")).toBe("nichtpruefen");
    expect(foldKey("NICHT PRUEFEN")).toBe("nichtpruefen");
    expect(foldKey("KI-Anbieter")).toBe("kianbieter");
    expect(foldKey("Schlüssel aus")).toBe("schluesselaus");
  });
});

describe("parseDurationMinutes", () => {
  it("liest die Schreibweisen der Vorlage", () => {
    expect(parseDurationMinutes("30 Minuten")).toBe(30);
    expect(parseDurationMinutes("2 Stunden")).toBe(120);
    expect(parseDurationMinutes("1 Tag")).toBe(1440);
    expect(parseDurationMinutes("45 min")).toBe(45);
  });

  it("liest eine nackte Zahl als Minuten", () => {
    expect(parseDurationMinutes("15")).toBe(15);
  });

  it("gibt null zurück, wenn keine Zahl dasteht", () => {
    // Lieber "nicht konfiguriert" als eine erfundene Frist.
    expect(parseDurationMinutes("ab und zu")).toBeNull();
  });
});

describe("parseHealthMd", () => {
  it("AC: ohne health.md bleibt jede Angabe leer", () => {
    expect(parseHealthMd(null)).toEqual(EMPTY_SPEC);
    expect(parseHealthMd("   ")).toEqual(EMPTY_SPEC);
    expect(parseHealthMd(null).present).toBe(false);
  });

  it("liest die Datenbank-Angaben", () => {
    expect(parseHealthMd(HEALTH_MD).database).toEqual({
      container: "lgt-prod-db",
      database: "livinggarden",
      user: "lgt",
    });
  });

  it("liest je Umgebung eine Web-Prüfung mit ihrem erwarteten Status", () => {
    expect(parseHealthMd(HEALTH_MD).web).toEqual([
      { env: "dev", url: "https://dev.livinggarden.example", expect: "307" },
      { env: "prod", url: "https://livinggarden.example", expect: "200, 307" },
    ]);
  });

  it("liest den Datenfluss samt Frist", () => {
    expect(parseHealthMd(HEALTH_MD).dataflow).toEqual({
      description: "Zigbee-Sensorwerte aus dem Gewächshaus",
      source: "Tabelle `sensor_readings`, Spalte `recorded_at`",
      maxAgeMinutes: 30,
    });
  });

  it("liest Anbieter und den NAMEN der Schlüssel-Variablen", () => {
    expect(parseHealthMd(HEALTH_MD).ai).toEqual({
      provider: "openai",
      keyEnv: "OPENAI_API_KEY",
    });
  });

  it("liest 'Nicht prüfen' als Container-Namen, ohne die Begründung", () => {
    expect(parseHealthMd(HEALTH_MD).ignore).toEqual(["lgt-prod-backup"]);
  });

  it("lässt eine Prüfart unkonfiguriert, wenn ihr Abschnitt unvollständig ist", () => {
    const spec = parseHealthMd("## Datenfluss\n\n- Beschreibung: Sensoren\n");
    // Ohne "Woran erkennbar" und ohne Frist ist nichts prüfbar.
    expect(spec.dataflow).toBeNull();
  });

  it("versteht einen ausdrücklichen Container-Abschnitt", () => {
    const spec = parseHealthMd(
      "## Container\n\n- Projekt: `lgt-prod`, `lgt-dev`\n- Präfix: `garden-`\n",
    );
    expect(spec.containers).toEqual({
      projects: ["lgt-prod", "lgt-dev"],
      prefixes: ["garden-"],
      names: [],
    });
  });
});

describe("appTokens — unter welchen Namen eine App läuft", () => {
  it("kennt den vollen Namen und die Initialen", () => {
    expect(appTokens("LivingGardenTwin")).toEqual(["livinggardentwin", "lgt"]);
  });

  it("zerlegt auch Bindestrich-Namen", () => {
    expect(appTokens("living-garden-twin")).toEqual(["livinggardentwin", "lgt"]);
  });

  it("hat bei einem Ein-Wort-Namen nur diesen einen", () => {
    expect(appTokens("appbaua")).toEqual(["appbaua"]);
  });
});

describe("matchContainers", () => {
  const containers = [
    container({ id: "a", name: "lgt-prod-app" }),
    container({ id: "b", name: "lgt-prod-db" }),
    container({ id: "c", name: "lgt-prod-backup" }),
    container({ id: "d", name: "appbaua-dev-app", project: "appbaua-dev" }),
    container({ id: "e", name: "lgthouse-app", project: "lgthouse" }),
  ];

  it("findet die Container über die Initialen des App-Namens", () => {
    const found = matchContainers(parseHealthMd(null), "LivingGardenTwin", containers);
    expect(found.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("nimmt nur ganze Namensteile — lgthouse ist nicht lgt", () => {
    const found = matchContainers(parseHealthMd(null), "LivingGardenTwin", containers);
    expect(found.map((c) => c.name)).not.toContain("lgthouse-app");
  });

  it("lässt aus, was unter 'Nicht prüfen' steht", () => {
    const found = matchContainers(parseHealthMd(HEALTH_MD), "LivingGardenTwin", containers);
    expect(found.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("folgt einem ausdrücklichen Container-Abschnitt statt zu raten", () => {
    const spec = parseHealthMd("## Container\n\n- Projekt: `appbaua-dev`\n");
    const found = matchContainers(spec, "LivingGardenTwin", containers);
    expect(found.map((c) => c.id)).toEqual(["d"]);
  });
});

describe("Container-Zustand", () => {
  it("AC: eine Neustart-Schleife ist ein Befund", () => {
    const looping = container({ state: "restarting", status: "Restarting (1) 5 seconds ago" });
    expect(isRestartLoop(looping)).toBe(true);
    expect(isContainerFailing(looping)).toBe(true);
  });

  it("ein laufender Container ist keiner", () => {
    expect(isContainerFailing(container())).toBe(false);
  });

  it("ein gestoppter Container ist einer", () => {
    expect(isContainerFailing(container({ state: "exited", status: "Exited (0)" }))).toBe(
      true,
    );
  });
});

describe("statusMatches", () => {
  it("vergleicht einen genannten Code", () => {
    expect(statusMatches(307, "307")).toBe(true);
    expect(statusMatches(200, "307")).toBe(false);
  });

  it("versteht eine Liste", () => {
    expect(statusMatches(200, "200, 307")).toBe(true);
    expect(statusMatches(307, "200, 307")).toBe(true);
    expect(statusMatches(500, "200, 307")).toBe(false);
  });

  it("versteht eine Klasse", () => {
    expect(statusMatches(204, "2xx")).toBe(true);
    expect(statusMatches(302, "2xx")).toBe(false);
  });

  it("ohne Angabe gilt alles unter 400 als gesund — auch die Anmelde-Weiterleitung", () => {
    expect(statusMatches(307, "")).toBe(true);
    expect(statusMatches(503, "")).toBe(false);
  });
});

describe("lampFor", () => {
  const at = "2026-08-29T10:00:00.000Z";
  const check = (status: "ok" | "fail" | "unknown" | "unconfigured" | "off") => ({
    kind: "container" as const,
    status,
    detail: "",
    checkedAt: at,
  });

  it("AC: eine bestandene Prüfung und keine rote ergibt Grün", () => {
    expect(lampFor([check("ok"), check("unconfigured")])).toBe("green");
  });

  it("AC: eine einzige rote Prüfung macht die Ampel rot", () => {
    expect(lampFor([check("ok"), check("fail")])).toBe("red");
  });

  it("ohne belastbares Ergebnis bleibt sie unbekannt", () => {
    expect(lampFor([check("unknown"), check("off")])).toBe("unknown");
  });
});

describe("pendingHealth", () => {
  it("AC: liegt noch kein Ergebnis vor, steht die Karte auf 'noch nicht geprüft'", () => {
    const app = pendingHealth({ id: "r1", name: "LivingGardenTwin", url: "u" });
    expect(app.lamp).toBe("unknown");
    expect(app.checkedAt).toBeNull();
    expect(app.checks).toHaveLength(CHECK_KINDS.length);
    expect(app.checks.every((c) => c.detail === "noch nicht geprüft")).toBe(true);
  });
});

describe("newestCheckedAt", () => {
  it("nimmt den jüngsten Zeitstempel", () => {
    expect(
      newestCheckedAt([
        { kind: "web", status: "ok", detail: "", checkedAt: "2026-08-29T10:00:00.000Z" },
        { kind: "ai", status: "ok", detail: "", checkedAt: "2026-08-29T12:00:00.000Z" },
        { kind: "container", status: "off", detail: "", checkedAt: null },
      ]),
    ).toBe("2026-08-29T12:00:00.000Z");
  });

  it("ist null, solange nichts gelaufen ist", () => {
    expect(
      newestCheckedAt([{ kind: "web", status: "unknown", detail: "", checkedAt: null }]),
    ).toBeNull();
  });
});
