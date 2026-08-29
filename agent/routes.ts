// Die Aufrufe, die der Health-Agent überhaupt kennt (req-032). Eigene Datei
// ohne Nebenwirkungen: index.ts startet beim Laden einen Server, und diese
// Entscheidung soll ohne Server prüfbar sein.
//
// Vier Formen, sonst nichts. Insbesondere gibt es keinen Weg, einen beliebigen
// Pfad an die Docker-Engine durchzureichen.

export type AgentRoute =
  | { kind: "list" }
  | { kind: "env"; id: string }
  | { kind: "exec"; id: string }
  | { kind: "restart"; id: string };

export function route(method: string, pathname: string): AgentRoute | null {
  if (method === "GET" && pathname === "/containers") return { kind: "list" };
  const m = pathname.match(/^\/containers\/([^/]+)\/(env|exec|restart)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (m[2] === "env" && method === "GET") return { kind: "env", id };
  if (m[2] === "exec" && method === "POST") return { kind: "exec", id };
  if (m[2] === "restart" && method === "POST") return { kind: "restart", id };
  return null;
}
