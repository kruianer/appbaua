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
    const sockets = bindMounts(COMPOSE).filter((m) =>
      hostSide(m).endsWith("docker.sock"),
    );
    expect(sockets).toEqual([]);
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
