import http from "node:http";
import type { DockerContainer } from "./health";

// Zugriff auf die Docker-Engine für die Zustandsübersicht (req-032): auflisten,
// eine Umgebungsvariable lesen, einen Befehl ausführen, einen Container neu
// starten.
//
// Gesprochen wird die HTTP-API der Engine über ihren Unix-Socket. Es gibt dafür
// keine Abhängigkeit im Projekt und braucht auch keine: die vier Aufrufe sind
// vier GET/POST auf einen lokalen Socket.
//
// WER den Socket haben darf, ist die eigentliche Entscheidung hier. Nicht die
// App: bug-005 hat den Lesebereich des einzigen internetzugewandten Prozesses
// klein gemacht, und der Socket wäre das genaue Gegenteil davon. Stattdessen
// hält ihn ein eigener, winziger Dienst (agent/index.ts, Compose-Dienst
// `health-agent`), der keinen Port veröffentlicht; die App spricht über das
// Compose-Netz mit ihm. Beide Seiten benutzen dieselbe Schnittstelle unten —
// createSocketDocker im Agenten, createRemoteDocker in der App.
//
// appbaua startet NIE von sich aus etwas neu (req-032): `restart` wird
// ausschließlich aus der Restart-Route heraus aufgerufen, also auf Klick.

/** Wo der Socket liegt; überschreibbar für abweichende Installationen. */
export const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";

/** Kein Aufruf an die Engine darf die Seite aufhalten. */
export const DOCKER_TIMEOUT_MS = 5_000;

/**
 * Was `exec` überhaupt starten darf. Die Prüfungen brauchen genau diese zwei
 * Programme (req-032: Datenbank und Datenfluss); alles andere wäre eine
 * beliebige Befehlsausführung als root auf dem Host, und dafür gibt es hier
 * keinen Grund. Der Agent weist einen nicht gelisteten Befehl ab.
 */
export const ALLOWED_EXEC_COMMANDS = ["pg_isready", "psql"] as const;

export function isAllowedCommand(cmd: unknown): cmd is string[] {
  return (
    Array.isArray(cmd) &&
    cmd.length > 0 &&
    cmd.every((part) => typeof part === "string") &&
    (ALLOWED_EXEC_COMMANDS as readonly string[]).includes(cmd[0])
  );
}

export type ExecResult = { exitCode: number | null; output: string };

export interface DockerClient {
  /** Alle Container des Rechners, auch gestoppte. */
  list(): Promise<DockerContainer[]>;
  /**
   * EINE Umgebungsvariable eines Containers, oder null. Bewusst nicht die
   * ganze Umgebung: die KI-Prüfung braucht genau einen benannten Schlüssel,
   * und alles andere wäre ein Auszug aller Geheimnisse aller Apps.
   */
  env(id: string, name: string): Promise<string | null>;
  /** Einen erlaubten Befehl IM Container ausführen und die Ausgabe einsammeln. */
  exec(id: string, cmd: string[]): Promise<ExecResult>;
  /** Genau diesen einen Container neu starten — nur auf Klick (req-032). */
  restart(id: string): Promise<void>;
}

type RawContainer = {
  Id: string;
  Names?: string[];
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
};

/** Docker liefert Namen mit führendem Schrägstrich; der gehört nicht dazu. */
export function mapContainers(raw: RawContainer[]): DockerContainer[] {
  return raw
    .map((c) => ({
      id: c.Id,
      name: (c.Names?.[0] ?? "").replace(/^\//, ""),
      state: c.State ?? "",
      status: c.Status ?? "",
      project: c.Labels?.["com.docker.compose.project"] ?? "",
    }))
    .filter((c) => c.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "KEY=value" aus `Config.Env` in eine Map. */
export function parseEnvList(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of list) {
    const idx = line.indexOf("=");
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

type Response = { status: number; body: string };

function request(
  socketPath: string,
  method: string,
  requestPath: string,
  payload?: unknown,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request(
      {
        socketPath,
        method,
        path: requestPath,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : {},
        timeout: DOCKER_TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: text }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("Docker antwortet nicht")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function expectOk(res: Response, what: string): Response {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${what}: HTTP ${res.status}`);
  }
  return res;
}

/**
 * Der Client für den laufenden Server. Jeder Aufruf wirft, wenn die Engine
 * nicht erreichbar ist — die Prüfungen fangen das ab und melden "unbekannt"
 * statt Rot: eine Prüfung, die nicht laufen konnte, hat nichts gefunden.
 */
export function createSocketDocker(
  socketPath: string = process.env.DOCKER_SOCKET || DEFAULT_SOCKET_PATH,
): DockerClient {
  return {
    async list() {
      const res = expectOk(
        await request(socketPath, "GET", "/containers/json?all=true"),
        "Container auflisten",
      );
      return mapContainers(JSON.parse(res.body) as RawContainer[]);
    },

    async env(id, name) {
      const res = expectOk(
        await request(socketPath, "GET", `/containers/${encodeURIComponent(id)}/json`),
        "Container lesen",
      );
      const parsed = JSON.parse(res.body) as { Config?: { Env?: string[] } };
      return parseEnvList(parsed.Config?.Env ?? [])[name] ?? null;
    },

    async exec(id, cmd) {
      if (!isAllowedCommand(cmd)) throw new Error(`Befehl nicht erlaubt: ${cmd[0]}`);
      // Tty: true lässt die Engine die Ausgabe roh liefern statt in Stdout/
      // Stderr-Rahmen gemultiplext — für einen einzeiligen Befehl ist das
      // genau das, was gebraucht wird.
      const created = expectOk(
        await request(socketPath, "POST", `/containers/${encodeURIComponent(id)}/exec`, {
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Cmd: cmd,
        }),
        "Befehl anlegen",
      );
      const execId = (JSON.parse(created.body) as { Id: string }).Id;
      const started = expectOk(
        await request(socketPath, "POST", `/exec/${execId}/start`, {
          Detach: false,
          Tty: true,
        }),
        "Befehl starten",
      );
      const inspect = expectOk(
        await request(socketPath, "GET", `/exec/${execId}/json`),
        "Befehl auswerten",
      );
      const info = JSON.parse(inspect.body) as { ExitCode: number | null };
      return { exitCode: info.ExitCode, output: started.body.trim() };
    },

    async restart(id) {
      expectOk(
        await request(
          socketPath,
          "POST",
          `/containers/${encodeURIComponent(id)}/restart`,
        ),
        "Neustart",
      );
    },
  };
}

/**
 * Der Client der App: dieselbe Schnittstelle, aber über das Compose-Netz zum
 * health-agent statt zum Socket. Die App selbst kommt damit nie an die Engine.
 */
export function createRemoteDocker(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): DockerClient {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(DOCKER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`health-agent: HTTP ${res.status}`);
    return res.json();
  };
  const post = (path: string, payload?: unknown) =>
    call(path, {
      method: "POST",
      ...(payload === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
    });

  return {
    async list() {
      const data = (await call("/containers")) as { containers?: DockerContainer[] };
      return data.containers ?? [];
    },
    async env(id, name) {
      const data = (await call(
        `/containers/${encodeURIComponent(id)}/env?name=${encodeURIComponent(name)}`,
      )) as { value?: string | null };
      return data.value ?? null;
    },
    async exec(id, cmd) {
      const data = (await post(`/containers/${encodeURIComponent(id)}/exec`, {
        cmd,
      })) as ExecResult;
      return { exitCode: data.exitCode ?? null, output: data.output ?? "" };
    },
    async restart(id) {
      await post(`/containers/${encodeURIComponent(id)}/restart`);
    },
  };
}

/**
 * Der Client für diesen Prozess: über den health-agent, sobald seine Adresse
 * gesetzt ist (so läuft es im Deploy), sonst direkt über den Socket — das ist
 * der Fall lokaler Entwicklung auf dem eigenen Rechner.
 */
export function createDockerClient(): DockerClient {
  const agent = (process.env.HEALTH_AGENT_URL ?? "").trim();
  return agent ? createRemoteDocker(agent) : createSocketDocker();
}
