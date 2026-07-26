---
id: bug-010
app: appbaua
req: req-019
priority: high
created: 2026-07-26
---

# Observed

Der Worker lässt jedes appbaua-Requirement/-Bug am Test-Gate (req-019)
scheitern: die .md wandert nach failed/, im Verlauf steht sinngemäß "kein
vitest" / Test-Befehl nicht ausführbar. Zuletzt getroffen: bug-008
(Prio-Reihenfolge) — der failed-Commit hat nur die .md nach failed/
verschoben, kein Code geändert; der Fix wurde also nie angewandt, weil
das Gate schon vorher abbrach.

Lokal (auf meinem Rechner) ist vitest vorhanden und `npm test` läuft grün
(640/640). Im Worker-Container fehlt vitest.

# Expected

Der Worker kann im Container `npm test` (vitest) ausführen, sodass das
Test-Gate (req-019) echte grüne/rote Tests bewertet — statt jedes
Requirement an einem fehlenden Test-Runner scheitern zu lassen. Nach dem
Fix läuft `npm test` im Container genauso wie lokal.

# Steps

1. Worker ein beliebiges appbaua-Requirement bearbeiten lassen.
2. Am Ende greift das Test-Gate; der Test-Befehl scheitert mit "kein
   vitest" → .md nach failed/.

# Ursache (verifiziert) + Fix

Das Test-Gate (lib/test-gate.ts) leert vor dem Testen node_modules und
führt den Install-Befehl aus stack.md (`npm install`) neu aus
("fresh-checkout"-Semantik, req-019). Dieser Install lief aber mit
`NODE_ENV=production`: Der Worker-Container setzt NODE_ENV=production
(Dockerfile), und `run` (lib/workspace.ts) vererbt `process.env` an jeden
Kindprozess. Ein Production-Install überspringt devDependencies — und
vitest ist eine devDependency. Ergebnis: nach dem Install fehlt vitest,
`npm test` scheitert mit "kein vitest", das Gate wertet rot, jedes
Requirement landet in failed/.

Fix (in diesem Commit): Der Install-Schritt des Test-Gates erzwingt jetzt
eine Dev-Installation (NODE_ENV=development, NPM_CONFIG_PRODUCTION=false,
NPM_CONFIG_INCLUDE=dev), sodass die Test-Werkzeuge vorhanden sind. Der
Test-Befehl selbst läuft unverändert. Analog zu bug-006, aber generisch:
betrifft jeden Test-Runner, der in devDependencies liegt.
