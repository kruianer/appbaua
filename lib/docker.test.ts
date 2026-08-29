import { describe, it, expect } from "vitest";
import {
  ALLOWED_EXEC_COMMANDS,
  createRemoteDocker,
  demuxDockerLogs,
  isAllowedCommand,
  mapContainers,
  parseEnvList,
} from "./docker";

// req-032: der Weg zur Docker-Engine. Der Socket selbst wird hier nicht
// angefasst — geprüft wird, was die App aus den Antworten macht und was sie
// gar nicht erst durchlässt.

describe("mapContainers", () => {
  it("nimmt den Namen ohne Docker-Schrägstrich und das Compose-Projekt mit", () => {
    expect(
      mapContainers([
        {
          Id: "abc",
          Names: ["/lgt-prod-app"],
          State: "running",
          Status: "Up 3 hours",
          Labels: { "com.docker.compose.project": "lgt-prod" },
        },
      ]),
    ).toEqual([
      {
        id: "abc",
        name: "lgt-prod-app",
        state: "running",
        status: "Up 3 hours",
        project: "lgt-prod",
      },
    ]);
  });

  it("überlebt einen Container ohne Labels", () => {
    const [c] = mapContainers([{ Id: "x", Names: ["/allein"] }]);
    expect(c.project).toBe("");
    expect(c.state).toBe("");
  });

  it("sortiert nach Namen, damit die Karte nicht springt", () => {
    const names = mapContainers([
      { Id: "1", Names: ["/b"] },
      { Id: "2", Names: ["/a"] },
    ]).map((c) => c.name);
    expect(names).toEqual(["a", "b"]);
  });
});

describe("parseEnvList", () => {
  it("liest KEY=value, auch mit Gleichheitszeichen im Wert", () => {
    expect(parseEnvList(["A=1", "B=x=y", "kaputt"])).toEqual({ A: "1", B: "x=y" });
  });
});

describe("isAllowedCommand — die Erlaubnisliste für exec", () => {
  it("lässt genau die Befehle der Prüfungen durch", () => {
    expect(ALLOWED_EXEC_COMMANDS).toEqual(["pg_isready", "psql"]);
    expect(isAllowedCommand(["pg_isready", "-U", "lgt"])).toBe(true);
    expect(isAllowedCommand(["psql", "-tAc", "SELECT 1"])).toBe(true);
  });

  it("weist alles andere ab — kein beliebiger Befehl als root auf dem Host", () => {
    expect(isAllowedCommand(["sh", "-c", "rm -rf /"])).toBe(false);
    expect(isAllowedCommand([])).toBe(false);
    expect(isAllowedCommand("psql")).toBe(false);
    expect(isAllowedCommand([1, 2])).toBe(false);
  });
});

describe("demuxDockerLogs — Docker rahmt die Logausgabe (req-035)", () => {
  /** Ein Rahmen: 1 Byte Strom, 3 Byte 0, 4 Byte Länge, dann der Text. */
  function frame(stream: number, text: string): Buffer {
    const body = Buffer.from(text, "utf8");
    const head = Buffer.alloc(8);
    head[0] = stream;
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  }

  it("setzt Standardausgabe und Standardfehler in ihrer Reihenfolge zusammen", () => {
    const raw = Buffer.concat([
      frame(1, "startup ok\n"),
      frame(2, "ERROR out of memory\n"),
    ]);
    expect(demuxDockerLogs(raw)).toBe("startup ok\nERROR out of memory\n");
  });

  it("lässt ungerahmte Ausgabe unangetastet — ein Container mit TTY liefert die", () => {
    const raw = Buffer.from("einfach nur Text\nzweite Zeile\n", "utf8");
    expect(demuxDockerLogs(raw)).toBe("einfach nur Text\nzweite Zeile\n");
  });

  it("verträgt eine leere Antwort", () => {
    expect(demuxDockerLogs(Buffer.alloc(0))).toBe("");
  });
});

describe("createRemoteDocker — die App spricht über den health-agent", () => {
  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    return (async (url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => handler(String(url), init),
    })) as unknown as typeof fetch;
  }

  it("holt die Container-Liste", async () => {
    const docker = createRemoteDocker(
      "http://health-agent:3100",
      stubFetch(() => ({
        containers: [
          { id: "a", name: "lgt-prod-app", state: "running", status: "Up", project: "lgt-prod" },
        ],
      })),
    );
    expect((await docker.list()).map((c) => c.name)).toEqual(["lgt-prod-app"]);
  });

  it("fragt EINE Umgebungsvariable ab, nicht die ganze Umgebung", async () => {
    const urls: string[] = [];
    const docker = createRemoteDocker(
      "http://health-agent:3100",
      stubFetch((url) => {
        urls.push(url);
        return { value: "sk-test" };
      }),
    );
    expect(await docker.env("abc", "OPENAI_API_KEY")).toBe("sk-test");
    expect(urls[0]).toBe(
      "http://health-agent:3100/containers/abc/env?name=OPENAI_API_KEY",
    );
  });

  it("holt die letzten Logzeilen — begrenzt und nur lesend (req-035)", async () => {
    const urls: string[] = [];
    const docker = createRemoteDocker(
      "http://health-agent:3100",
      stubFetch((url) => {
        urls.push(url);
        return { logs: "Zeile 1\nZeile 2" };
      }),
    );
    expect(await docker.logs("abc", 200)).toBe("Zeile 1\nZeile 2");
    expect(urls[0]).toBe("http://health-agent:3100/containers/abc/logs?tail=200");
  });

  it("schickt den Neustart an genau einen Container", async () => {
    const calls: { url: string; method?: string }[] = [];
    const docker = createRemoteDocker(
      "http://health-agent:3100",
      stubFetch((url, init) => {
        calls.push({ url, method: init?.method });
        return {};
      }),
    );
    await docker.restart("abc");
    expect(calls).toEqual([
      { url: "http://health-agent:3100/containers/abc/restart", method: "POST" },
    ]);
  });

  it("eine abschlägige Antwort des Agenten wirft, statt still nichts zu tun", async () => {
    const docker = createRemoteDocker("http://health-agent:3100", (async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
    })) as unknown as typeof fetch);
    await expect(docker.list()).rejects.toThrow("HTTP 400");
  });
});
