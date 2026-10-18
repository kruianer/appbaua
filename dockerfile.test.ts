import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// bug-028: Der Chat (req-040) laeuft im App-Container und ruft dieselbe
// runClaude-Funktion wie der Worker auf, aber die Claude-Code-CLI wurde nur im
// Worker-Container installiert (Dockerfile.worker). Jede Chat-Nachricht endete
// mit "Claude-Code-CLI nicht verfuegbar" (lib/claude-runner.ts, code 127).
//
// Entschieden: Der App-Container wird ausgestattet, statt den Chat in den
// Worker-Container zu verlegen. Dieser Test haelt fest, dass die CLI auch hier
// installiert ist und HOME auf die eingehaengte Anmeldung zeigt.

const DOCKERFILE = readFileSync(
  path.join(process.cwd(), "Dockerfile"),
  "utf8",
);

describe("Dockerfile — Claude-Code-CLI im App-Container (bug-028)", () => {
  it("AC: die CLI wird installiert, nicht nur im Worker-Image", () => {
    expect(DOCKERFILE).toContain("npm install -g @anthropic-ai/claude-code");
  });

  it("AC: HOME zeigt auf das eingehaengte claude-home-Volume, nicht auf /home/nextjs", () => {
    // Ohne das findet die CLI die Anmeldung aus dem Abo nicht, selbst wenn sie
    // installiert ist — gemessen stand HOME zuvor auf /home/nextjs.
    expect(DOCKERFILE).toContain("ENV HOME=/claude-home");
  });
});
