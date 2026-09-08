// Health-Agent (req-032): der einzige Prozess mit Zugriff auf den
// Docker-Socket. Er läuft als eigener Compose-Dienst ohne veröffentlichten
// Port und ist damit nur aus dem Compose-Netz erreichbar — also aus der App.
//
// Warum es ihn gibt: bug-005 hat den Lesebereich des internetzugewandten
// App-Containers klein gemacht. Der Docker-Socket dort wäre das genaue
// Gegenteil (wer mit der Engine reden darf, ist auf dem Host praktisch root).
// Also bekommt ihn ein Dienst, der sonst nichts kann und nichts sieht.
//
// Er nimmt genau fünf Aufrufe entgegen:
//   GET  /containers                 alle Container (auch gestoppte)
//   GET  /containers/:id/env?name=X  EINE Umgebungsvariable
//   POST /containers/:id/exec        ein Befehl aus der Erlaubnisliste
//   GET  /containers/:id/logs?tail=N die letzten N Logzeilen (req-035)
//   POST /containers/:id/restart     Neustart genau dieses Containers
// Alles andere ist 404. Insbesondere gibt es keinen Durchgriff auf die
// Engine-API und keinen Weg, einen beliebigen Befehl zu starten.

import http from "node:http";
import { createSocketDocker, isAllowedCommand } from "../lib/docker";
import { route } from "./routes";

const PORT = Number(process.env.HEALTH_AGENT_PORT || 3100);
const docker = createSocketDocker();

/** Obergrenze der Logzeilen, die der Agent je Aufruf herausgibt (req-035). */
const MAX_AGENT_LOG_LINES = 500;

type Handler = () => Promise<unknown>;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      text += chunk;
      // Ein Aufruf hier ist immer eine Handvoll Bytes; alles darüber ist ein
      // Fehler oder ein Angriff, und beides wird abgebrochen.
      if (text.length > 8192) reject(new Error("Anfrage zu groß"));
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://health-agent");
  const target = route(req.method ?? "GET", url.pathname);

  const send = (status: number, payload: unknown) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };

  if (!target) {
    send(404, { error: "unbekannter Aufruf" });
    return;
  }

  const handlers: Record<string, Handler> = {
    list: async () => ({ containers: await docker.list() }),
    env: async () => {
      if (target.kind !== "env") return {};
      const name = url.searchParams.get("name") ?? "";
      if (!name) throw new Error("name fehlt");
      return { value: await docker.env(target.id, name) };
    },
    exec: async () => {
      if (target.kind !== "exec") return {};
      const body = JSON.parse((await readBody(req)) || "{}") as { cmd?: unknown };
      // Doppelt geprüft — auch der Socket-Client weist es ab. Hier steht die
      // Entscheidung aber an der Grenze, an der sie hingehört.
      if (!isAllowedCommand(body.cmd)) throw new Error("Befehl nicht erlaubt");
      return docker.exec(target.id, body.cmd);
    },
    logs: async () => {
      if (target.kind !== "logs") return {};
      // Immer begrenzt, auch wenn der Aufrufer nichts oder Unsinn schickt: der
      // Agent soll kein ganzes Tageslog durch das Compose-Netz schieben.
      const asked = Number(url.searchParams.get("tail") ?? MAX_AGENT_LOG_LINES);
      const tail = Number.isFinite(asked)
        ? Math.min(MAX_AGENT_LOG_LINES, Math.max(1, Math.floor(asked)))
        : MAX_AGENT_LOG_LINES;
      return { logs: await docker.logs(target.id, tail) };
    },
    restart: async () => {
      if (target.kind !== "restart") return {};
      await docker.restart(target.id);
      return { restarted: target.id };
    },
  };

  try {
    send(200, await handlers[target.kind]());
  } catch (err) {
    send(400, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[health-agent] hört auf ${PORT}`);
});
