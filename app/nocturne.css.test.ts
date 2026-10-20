import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// bug-013: links carried no color of their own — the auth pages only set
// fontSize/textAlign as inline styles — so the browser applied its default
// palette (blue unvisited, purple visited) on the dark background. A shared
// rule fixes it for every page that uses a plain <a>, current or future,
// without each page repeating it.

function cssRule(selector: string): string {
  const css = readFileSync(path.join(process.cwd(), "app", "nocturne.css"), "utf8");
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("Rollbalken (bug-033)", () => {
  it("färbt den Rollbalken in der Akzentfarbe statt im grauen Standard", () => {
    expect(cssRule("html")).toMatch(/scrollbar-color:\s*var\(--color-accent\)/);
  });

  it("färbt auch den WebKit-Rollbalken (scrollbar-color wird dort ignoriert)", () => {
    expect(cssRule("::-webkit-scrollbar-thumb")).toMatch(
      /background:\s*var\(--color-accent\)/,
    );
  });
});

describe("Links (bug-013)", () => {
  it("gives unvisited links the readable text color, not the browser default", () => {
    expect(cssRule("a")).toMatch(/color:\s*var\(--color-text\)/);
  });

  it("gives visited links the SAME color as unvisited — no purple drift", () => {
    expect(cssRule("a:visited")).toMatch(/color:\s*var\(--color-text\)/);
  });
});
