---
id: bug-002
title: Worker läuft bei Dauerfehler heiß (keine Pause) und wiederholt fehlgeschlagene .md endlos
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-25
relates: req-004, req-006, req-008
quelle: Code-Review 2026-07-25 (Punkte 1+2)
---

# Beobachtetes Verhalten

Zwei ineinandergreifende Fehler führen dazu, dass ein dauerhaft
fehlschlagender Schritt den Worker in eine Endlosschleife ohne Pause
treibt:

1. **Keine Pause bei Fehlern:** `lib/worker-loop.ts:132` zählt auch
   `error`-Schritte als „erledigt" (`done`), und `:157` pausiert nur bei
   `done === 0`. Ein Schritt, der immer fehlschlägt (fehlende Claude-CLI
   → code 127, fehlende Push-Rechte, kaputtes Repo), liefert in jedem
   Durchlauf `done > 0` → keine 5-Minuten-Pause, sofort der nächste
   Durchlauf. Folge: `git fetch` im Sekundentakt, das Verlauf-Log läuft
   voll, Rate-Limits werden verbrannt.

2. **`failed/` wird nie persistiert:** `lib/execute-step.ts:136-146`
   verschiebt die .md bei Misserfolg lokal nach `failed/`, kehrt aber vor
   `commitAndPush` zurück. Beim nächsten Lauf setzt `prepareRepo` per
   `git reset --hard origin/dev` alles zurück — die getrackte
   `ready/x.md` ist wieder da, die untrackte `failed/x.md` bleibt liegen.
   Die fehlschlagende Aufgabe wird unbegrenzt neu versucht; wird später
   ein anderer Schritt im selben Repo erfolgreich, zieht `git add -A` die
   verwaiste `failed/x.md` mit — die Datei liegt dann gleichzeitig in
   `ready/` UND `failed/`.

# Erwartetes Verhalten

- Ein dauerhaft fehlschlagender Task blockiert den Worker nicht und führt
  nicht zu einer pausenlosen Endlosschleife; nach Fehlern greift eine
  Pause bzw. ein Backoff.
- Eine nach `failed/` verschobene .md wird committet und gepusht, sodass
  sie beim nächsten Lauf nicht wieder in `ready/` auftaucht und nicht
  endlos wiederholt wird. Sie liegt nie gleichzeitig in `ready/` und
  `failed/`.

# Vorgeschlagene Lösung (aus dem Review)

- `done` nur bei `success` hochzählen, ODER ein eigener Fehlerzähler mit
  exponentiellem Backoff pro `repo × taskType`.
- Den `failed/`-Move committen und pushen (eigener Commit „worker: x.md
  fehlgeschlagen"), bevor der Fehler zurückgegeben wird.

# Akzeptanzkriterien

- [ ] Given ein Schritt schlägt in jedem Durchlauf fehl, when mehrere
  Durchläufe vergehen, then läuft der Worker NICHT pausenlos im
  Sekundentakt, sondern pausiert/backofft zwischen den Versuchen.
- [ ] Given ein Schritt für "x.md" schlägt fehl, when der Worker den
  Fehler behandelt, then liegt "x.md" danach in `failed/` (committet und
  gepusht) und NICHT mehr in `ready/`.
- [ ] Given eine .md wurde nach `failed/` verschoben, when ein späterer
  erfolgreicher Schritt im selben Repo committet, then taucht die
  fehlgeschlagene .md NICHT gleichzeitig in `ready/` und `failed/` auf.

# Out of Scope

- Automatische Wiederholungs-Strategie für failed/-Dateien über die
  Basis-Persistierung hinaus (die bleiben liegen, bis der Mensch sie
  ansieht).
