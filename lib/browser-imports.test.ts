import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Was die Oberfläche importiert, muss im Browser laufen. Zieht eine Komponente
// über Umwege eine Datei mit `node:fs`, `node:path` oder Kindprozessen herein,
// bricht der Next.js-Build — nicht der Typecheck, nicht die Tests, erst der
// Build. Das ist spät und der Fehlertext ("Module not found: node:path") sagt
// nichts über die Ursache.
//
// Zweimal passiert: bei req-023 zog `middleware.ts` über `auth-session.ts` den
// halben Server nach (daher `auth-cookie-name.ts`), und bei req-037 zog
// `RunLog.tsx` über `error-kind.ts` die `workspace.ts` (daher
// `network-errors.ts`). Beide Male war die Lösung dieselbe: das Gemeinsame in
// eine Datei ohne Nachzieher.
//
// Dieser Test zieht die Grenze vor dem Build ein.

const ROOT = process.cwd();

/** Module, die es im Browser nicht gibt. */
const NODE_ONLY = /(^|["'`])node:|(^|["'`])(fs|path|child_process|crypto|os|net|tls|http|https)(["'`]|\/)/;

/**
 * Was eine Datei aus dem Projekt importiert, als Pfad relativ zu lib/.
 *
 * `import type` zaehlt NICHT: Solche Angaben verschwinden beim Uebersetzen und
 * landen nie im Bundle. Eine Komponente darf einen Typ aus einer serverseitigen
 * Datei beziehen, solange sie keinen Wert von dort nimmt — genau so machen es
 * HealthOverview und WorkerDashboard.
 */
function localImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /(?:import|export)(\s+type)?[^"'`]*from\s+["'`](\.\/[^"'`]+|@\/lib\/[^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) continue; // import type — verschwindet beim Uebersetzen
    const spec = m[2].replace(/^@\/lib\//, "./");
    out.push(spec.replace(/^\.\//, ""));
  }
  return out;
}

/** Importiert diese lib-Datei — direkt oder über Umwege — etwas Node-Eigenes? */
function pullsInNode(
  name: string,
  seen = new Set<string>(),
): string | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const file = path.join(ROOT, "lib", `${name}.ts`);
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    return null; // keine lib-Datei (z.B. ein Paket) — nicht unsere Sorge
  }
  for (const line of src.split("\n")) {
    if (/^\s*(import|export)\b/.test(line) && NODE_ONLY.test(line)) {
      return name;
    }
  }
  for (const dep of localImports(file)) {
    const found = pullsInNode(dep, seen);
    if (found) return found;
  }
  return null;
}

/** Alle Komponenten — sie laufen im Browser. */
function componentFiles(): string[] {
  const dir = path.join(ROOT, "components");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => path.join(dir, f));
}

describe("Browser-Grenze: Komponenten ziehen keine node-Module nach", () => {
  it("AC: keine Komponente importiert ueber Umwege node:fs, node:path o.ae.", () => {
    const verstoesse: string[] = [];
    for (const file of componentFiles()) {
      for (const dep of localImports(file)) {
        const schuldig = pullsInNode(dep);
        if (schuldig) {
          verstoesse.push(
            `${path.basename(file)} -> ${dep}` +
              (schuldig === dep ? "" : ` -> … -> ${schuldig}`),
          );
        }
      }
    }
    // Die Meldung nennt den Weg, nicht nur das Ergebnis — beim naechsten Mal
    // soll sofort klar sein, WELCHER Import die Grenze reisst.
    expect(verstoesse).toEqual([]);
  });

  it("network-errors bleibt frei von Importen (req-037)", () => {
    // Der ganze Zweck dieser Datei. Ein einziger Import koennte die Kette
    // wieder aufmachen.
    const src = readFileSync(path.join(ROOT, "lib", "network-errors.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
  });

  it("auch die middleware bleibt frei von node-Modulen (req-023)", () => {
    // Sie laeuft in der Edge-Runtime, dieselbe Einschraenkung aus anderem
    // Grund. Der Fall, an dem das Muster zuerst auffiel.
    for (const dep of localImports(path.join(ROOT, "middleware.ts"))) {
      expect(pullsInNode(dep)).toBeNull();
    }
  });
});
