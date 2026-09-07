---
id: req-036
title: Der Worker arbeitet in Etappen und setzt nach einem Abbruch dort fort
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-09-07
---

# Goal (Why)

Bricht ein Lauf ab, ist alles verloren — auch nach einer halben Stunde
Arbeit. Am 07.09. traf es bug-021 in Wegfara: 16 Minuten gearbeitet, die
Verbindung riss mitten in der Antwort, das Paket landete unbearbeitet in
`failed/`. Ich will, dass geleistete Arbeit erhalten bleibt und der
nächste Lauf dort weitermacht, wo der letzte aufgehört hat.

# Function (What)

Der Worker arbeitet ein Requirement oder einen Bug nicht mehr in einem
Zug ab, sondern in Etappen. Eine Etappe ist ein Akzeptanzkriterium der
`.md`.

Nach jeder Etappe:

1. Die Testsuite läuft. Ist sie rot, gilt die Etappe als nicht fertig —
   der Worker arbeitet weiter, bis sie grün ist. Nur grüne Stände werden
   committet.
2. Das erledigte Kriterium wird in der `.md` abgehakt (`[x]`).
3. Der Stand wird committet, zusammen mit der geänderten `.md`, auf
   demselben Zweig wie bisher.

Bricht der Lauf danach ab — Verbindungsabbruch, Zeitüberschreitung,
Rate-Limit —, bleibt das Erreichte stehen und die `.md` bleibt in
`ready/`. Sie wandert NICHT nach `failed/`, denn an ihr ist nichts
falsch.

Der nächste Lauf liest die `.md`, sieht an den Häkchen, was erledigt ist,
und beginnt beim ersten offenen Kriterium. Er baut auf dem Vorhandenen
auf, statt neu anzufangen.

Erst wenn alle Kriterien abgehakt sind, ist das Paket fertig und wandert
nach `done/`.

Im Verlauf ist zu sehen, wie weit ein Lauf gekommen ist — welche
Kriterien er erledigt hat und bei welchem er abbrach.

# Acceptance Criteria

- [ ] Given ein Requirement mit fünf Akzeptanzkriterien, when der Worker
  es abarbeitet, then entsteht je erfülltem Kriterium ein eigener
  Commit — nicht ein einziger am Ende.
- [ ] Given der Worker hat gerade ein Kriterium umgesetzt und die
  Testsuite ist grün, when er committet, then trägt die mitcommittete
  `.md` bei genau diesem Kriterium ein `[x]`.
- [ ] Given die Testsuite ist nach einer Etappe rot, when der Worker
  weiterarbeitet, then wird dieser Stand NICHT committet.
- [ ] Given ein Lauf bricht nach drei von fünf Kriterien ab, when ich das
  Repo ansehe, then finde ich die Arbeit der drei Kriterien vor und die
  `.md` liegt weiterhin in `ready/`, nicht in `failed/`.
- [ ] Given eine `.md` mit drei von fünf abgehakten Kriterien, when der
  nächste Lauf sie aufnimmt, then beginnt er beim vierten Kriterium und
  baut das bereits Vorhandene NICHT noch einmal.
- [ ] Given alle Kriterien einer `.md` sind abgehakt, when der Lauf
  endet, then wandert sie nach `done/`.
- [ ] Given ein Lauf ist abgebrochen, when ich den Verlauf ansehe, then
  steht dort, welche Kriterien erledigt wurden und bei welchem der Lauf
  abbrach.
- [ ] Given ein Bug ohne Akzeptanzkriterien in der Datei, when der Worker
  ihn abarbeitet, then funktioniert der Lauf wie bisher — ein Commit am
  Ende, kein Fehler wegen fehlender Etappen.

# Constraints

- Der Auftragstext an Claude verbietet heute ausdrücklich das Committen
  ("Committe NICHT selbst und pushe NICHT — das übernimmt der Worker",
  `lib/claude-runner.ts`). Diese Vorgabe muss sich ändern, sonst kann
  keine Etappe entstehen.
- Bei einem Abbruch wird heute `discardChanges` aufgerufen — `git reset
  --hard` plus `git clean -fd` (`lib/execute-step.ts`, Zeilen ~411, 425,
  454, 471). Das ist genau die Stelle, an der die Arbeit verlorengeht.
  Committete Etappen dürfen davon nicht betroffen sein; nicht
  committete Reste weiterhin schon.
- Die Testsuite läuft künftig mehrfach je Paket statt einmal. Bei einer
  langsamen Suite verlängert das den Lauf spürbar.
- Manche Akzeptanzkriterien hängen zusammen und lassen sich nicht
  einzeln erfüllen (eine Tabelle bedient drei Kriterien auf einmal).
  Dann dürfen mehrere Kriterien in einer Etappe abgehakt werden — der
  Schnitt ist eine Empfehlung, keine Pflicht.

# Out of Scope

- Zwischenspeicherung nach Zeit statt nach Kriterium ("alle 10 Minuten").
- Aufteilen des Requirements in mehrere Dateien.
- Ein Fortsetzen über Repo-Grenzen hinweg oder das Zusammenführen von
  Ständen aus mehreren abgebrochenen Läufen.
- Rückgängigmachen einzelner Etappen über die Oberfläche.
- Automatisches Aufräumen unfertiger Etappen-Commits, wenn ein Paket
  endgültig aufgegeben wird.
