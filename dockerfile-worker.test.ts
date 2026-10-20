import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// bug-024: Der Worker-Container brachte die Werkzeuge nicht mit, die die
// betreuten Repos brauchen. Claude baute sie sich mitten im Lauf nach /tmp —
// eine Perl-Umgebung für die Bildmetadaten von Knipsa, eine Python-Umgebung für
// das Backend von Wellarita — und beim nächsten Lauf war /tmp wieder leer.
// Sieben von zehn Läufen über 40 Minuten gingen dafür hin.
//
// Dieser Test hält die Werkzeugliste des Images fest. Er prüft die
// Build-Konfiguration, weil das Problem nur dort entsteht: im Code ist nichts
// falsch, es fehlt im Container.

const DOCKERFILE = readFileSync(
  path.join(process.cwd(), "Dockerfile.worker"),
  "utf8",
);

/**
 * Alle Paketnamen, die das Image per `apk add` installiert. Zeilenfortsetzungen
 * (`\` am Zeilenende) werden zusammengezogen, Flags (`--no-cache`) fallen weg.
 */
function apkPackages(dockerfile: string): string[] {
  return dockerfile
    .replace(/\\\r?\n/g, " ")
    .split("\n")
    .flatMap((line) => line.split("&&"))
    .map((cmd) => cmd.trim())
    .filter((cmd) => /^(RUN\s+)?apk\s+add\b/.test(cmd))
    .flatMap((cmd) =>
      cmd
        .replace(/^(RUN\s+)?apk\s+add\b/, "")
        .trim()
        .split(/\s+/),
    )
    .filter((token) => token.length > 0 && !token.startsWith("-"));
}

const PACKAGES = apkPackages(DOCKERFILE);

describe("Dockerfile.worker — Systemwerkzeuge der betreuten Repos (bug-024)", () => {
  it("AC: Bildmetadaten lassen sich ohne Nachbau lesen — perl und exiftool", () => {
    // Knipsa liest Aufnahmezeit, GPS und Stichwörter aus den Fotos. Ohne diese
    // zwei baut Claude sich eine Perl-Umgebung nach /tmp/perlroot.
    expect(PACKAGES).toContain("perl");
    expect(PACKAGES).toContain("exiftool");
  });

  it("AC: ein Python-Backend lässt sich testen — python3 und py3-pip", () => {
    // Wellarita ist kein Node-Projekt; sein stack.md nennt `pip install -e`
    // und `pytest`. Im Image fehlte davon alles.
    expect(PACKAGES).toContain("python3");
    expect(PACKAGES).toContain("py3-pip");
  });

  it("AC: native Module und pip-Pakete ohne musl-Fassung lassen sich übersetzen", () => {
    // Alpine nutzt musl. Vorgefertigte Binärdateien passen dort oft nicht, also
    // wird übersetzt — node-gyp und pip brauchen dafür genau diese Kette.
    for (const tool of ["make", "gcc", "g++", "musl-dev", "python3-dev"]) {
      expect(PACKAGES).toContain(tool);
    }
  });

  it("nichts Unbelegtes im Image — jedes Paket kostet Platz und Bauzeit", () => {
    // bug-024 hat diese vier als fehlend gemessen, aber kein Repo verlangt sie.
    // Sie gehören erst hinein, wenn eines es tatsächlich tut (req-039).
    for (const tool of ["ffmpeg", "imagemagick", "sqlite3", "jq"]) {
      expect(PACKAGES).not.toContain(tool);
    }
  });

  it("der apk-Cache landet nicht im Image", () => {
    expect(DOCKERFILE).toMatch(/apk\s+add\s+--no-cache\b/);
  });
});

describe("Dockerfile.worker — was frühere Bugs erkämpft haben", () => {
  it("bash bleibt drin — ohne sie scheitert jeder Befehl des Workers (bug-016)", () => {
    expect(PACKAGES).toContain("bash");
    expect(DOCKERFILE).toContain("ENV SHELL=/bin/bash");
  });

  it("git und openssh bleiben drin — Klonen, Committen, Pushen", () => {
    expect(PACKAGES).toContain("git");
    expect(PACKAGES).toContain("openssh");
  });

  it("Chromium und die Schriften bleiben drin — Doku-Screenshots (req-017)", () => {
    // Playwright bringt für musl keinen Browser mit; ohne die Schriftpakete
    // rendern die Screenshots als leere Kästen.
    for (const pkg of ["chromium", "nss", "freetype", "harfbuzz", "ttf-freefont"]) {
      expect(PACKAGES).toContain(pkg);
    }
    expect(DOCKERFILE).toContain("ENV CHROMIUM_PATH=/usr/bin/chromium-browser");
  });
});
