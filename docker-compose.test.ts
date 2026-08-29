import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// bug-005: Der App-Container — der einzige internetzugewandte Prozess — hatte
// das GESAMTE Host-Dateisystem read-only gemountet (`/:/host/root:ro`), und das
// nur für ein statfs. Damit lagen u.a. ~/appbaua-env/*.env mit GITHUB_TOKEN und
// DB-Passwort in seinem Lesebereich. Dieser Test hält das Mount-Set klein; er
// prüft die Deploy-Konfiguration, weil sich die Angriffsfläche nur dort ergibt.

const COMPOSE = readFileSync(
  path.join(process.cwd(), "docker-compose.yml"),
  "utf8",
);

/**
 * Alle Bind-Mounts der Compose-Datei als `host:container[:mode]`. Benannte
 * Volumes (`db-data:/var/lib/...`) sind keine Bind-Mounts und fallen weg, weil
 * ihre linke Seite nicht mit "/" oder "." beginnt.
 */
function bindMounts(yaml: string): string[] {
  return yaml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^- (\/|\.)/.test(line))
    .map((line) => line.slice(2).trim());
}

/** Host-Seite eines Mounts (`/proc:/host/proc:ro` -> `/proc`). */
const hostSide = (mount: string): string => mount.split(":")[0];

/** Der Block eines Dienstes bis zum nächsten Dienst auf gleicher Ebene. */
function serviceBlock(name: string): string {
  const lines = COMPOSE.split("\n");
  const start = lines.findIndex((l) => l.trim() === `${name}:`);
  expect(start).toBeGreaterThan(-1);
  const next = lines.findIndex((l, i) => i > start && /^  \S/.test(l));
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
}

describe("docker-compose.yml — Mounts in den Containern", () => {
  it("AC: kein Container mountet das Host-Wurzelverzeichnis", () => {
    const roots = bindMounts(COMPOSE).filter((m) => hostSide(m) === "/");
    expect(roots).toEqual([]);
  });

  it("AC: freier Speicherplatz wird ohne Host-Mount ermittelt", () => {
    // statfs läuft auf dem eigenen Wurzel-Dateisystem des Containers.
    expect(COMPOSE).toContain('HOST_DISK: "/"');
    expect(COMPOSE).not.toContain("/host/root");
  });

  it("das Host-/proc bleibt gemountet — CPU- und RAM-Kacheln (req-009)", () => {
    expect(bindMounts(COMPOSE)).toContain("/proc:/host/proc:ro");
    expect(COMPOSE).toContain("HOST_PROC: /host/proc");
  });

  it("kein Docker-Socket im App-Container", () => {
    // req-032 braucht die Docker-Engine (Container-Prüfung und Neustart auf
    // Klick) — aber nicht HIER. Sie gehört dem health-agent, einem eigenen
    // Dienst ohne veröffentlichten Port; der internetzugewandte App-Container
    // bleibt so klein, wie bug-005 ihn gemacht hat. Deshalb prüft dieser Test
    // seit req-032 den app-Block statt der ganzen Datei.
    const sockets = bindMounts(serviceBlock("app")).filter((m) =>
      hostSide(m).endsWith("docker.sock"),
    );
    expect(sockets).toEqual([]);
  });

  it("auch der worker-Container bekommt den Socket nicht", () => {
    // Der Worker führt aus, was Claude Code schreibt. Von allen Containern ist
    // er der letzte, der auf dem Host praktisch root sein sollte.
    const sockets = bindMounts(serviceBlock("worker")).filter((m) =>
      hostSide(m).endsWith("docker.sock"),
    );
    expect(sockets).toEqual([]);
  });
});

describe("docker-compose.yml — Health-Agent (req-032)", () => {
  it("AC: genau ein Dienst hält den Docker-Socket, und das ist der health-agent", () => {
    const withSocket = bindMounts(serviceBlock("health-agent")).filter((m) =>
      hostSide(m).endsWith("docker.sock"),
    );
    expect(withSocket).toHaveLength(1);
    // Und sonst niemand in der ganzen Datei.
    const all = bindMounts(COMPOSE).filter((m) =>
      hostSide(m).endsWith("docker.sock"),
    );
    expect(all).toHaveLength(1);
  });

  it("AC: der Agent veröffentlicht keinen Port am Host", () => {
    // Erreichbar nur über das Compose-Netz, also aus der App heraus.
    expect(serviceBlock("health-agent")).not.toContain("ports:");
  });

  it("AC: die App spricht über den Agenten mit Docker, nicht selbst", () => {
    expect(serviceBlock("app")).toContain("HEALTH_AGENT_URL: http://health-agent:3100");
  });
});

describe("docker-compose.yml — PID 1 im Worker (bug-018)", () => {
  it("AC: der worker-Dienst laeuft mit einem echten init als PID 1", () => {
    // Ohne das ist PID 1 `npm run worker` — ein Node-Prozess, der geerbte
    // Kinder nie mit wait() abholt. git-Enkelkinder von Claude Code bleiben
    // dann als Zombies stehen, bis der Container nicht mehr forken kann.
    expect(serviceBlock("worker")).toMatch(/^\s*init:\s*true\s*$/m);
  });
});

describe("docker-compose.yml — Cloudflare Tunnel (req-024)", () => {
  it("AC: der Tunnel-Dienst ist konfiguriert und haengt am app-Dienst", () => {
    expect(COMPOSE).toContain("cloudflared:");
    expect(COMPOSE).toContain("cloudflare/cloudflared");
  });

  it("AC: der Tunnel-Token kommt aus der env-Datei, steht nie im Klartext im Repo", () => {
    expect(COMPOSE).toContain("${CLOUDFLARE_TUNNEL_TOKEN}");
    // A real token is a long opaque string; this file only ever names the var.
    expect(COMPOSE).not.toMatch(/CLOUDFLARE_TUNNEL_TOKEN\s*[:=]\s*[A-Za-z0-9._-]{20,}/);
  });

  it("AC: kein zusaetzlicher Port fuer den Tunnel-Dienst wird am Host geoeffnet", () => {
    const lines = COMPOSE.split("\n");
    const start = lines.findIndex((l) => l.trim() === "cloudflared:");
    const next = lines.findIndex(
      (l, i) => i > start && /^  \S/.test(l), // next top-level service/key
    );
    const block = lines.slice(start, next === -1 ? undefined : next).join("\n");
    expect(block).not.toContain("ports:");
  });
});
