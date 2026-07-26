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

# Hinweis zur Ursache (Verdacht, bitte verifizieren)

vitest ist in der package.json als devDependency deklariert
("vitest": "^3.2.7"). Der Worker-Container installiert aber vermutlich
OHNE devDependencies: das Dockerfile setzt `ENV NODE_ENV=production` und
`npm ci`, was devDependencies überspringt. Damit fehlt genau der
Test-Runner, den der Worker zur Laufzeit fürs Test-Gate braucht.

Der Fix soll sicherstellen, dass der Test-Runner (und die übrigen zum
Testen nötigen devDependencies) im Worker-Container verfügbar sind —
z.B. devDependencies mitinstallieren, oder die zum Testen nötigen Pakete
so bereitstellen, dass `npm test` im Container läuft. Analog zu bug-006
(playwright-core fehlte), aber hier generisch für den Test-Runner.
