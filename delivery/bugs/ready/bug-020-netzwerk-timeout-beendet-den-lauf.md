---
id: bug-020
app: appbaua
req: req-006
priority: normal
created: 2026-08-29
---

# Observed

Ein einzelner Netzwerk-Aussetzer beim Verbinden zu GitHub beendet den
ganzen Lauf. Der Worker versucht es kein zweites Mal, sondern gibt sofort
auf:

```
Repo vorbereiten fehlgeschlagen (LivingGardenKeeper): Error: default
branch unknown: fatal: unable to access
'https://github.com/kruianer/livinggardenkeeper.git/': Failed to connect
to github.com:443 after 134549 ms: Could not connect to server
```

Das passiert regelmäßig, verteilt über die Tage — an fünf von sieben
Tagen zwischen dem 23. und 29.08.:

```
08-23  1    08-24  1    08-25  2    08-27  1    08-29  2
```

Jedes Mal kostet es einen kompletten Durchlauf für das betroffene Repo.
Gegenprobe: Unmittelbar nach dem Fehlschlag ist das Repo mit demselben
Token einwandfrei erreichbar — es liegt weder am Repo noch am Zugang.

# Expected

Ein einzelner Aussetzer beim Verbindungsaufbau beendet den Lauf nicht.
Der Worker versucht es nach kurzer Wartezeit noch einmal und arbeitet
weiter, wenn der zweite Versuch klappt. Erst wenn auch der scheitert,
gilt das Repo als nicht erreichbar.

# Steps

1. Worker über mehrere Tage laufen lassen.
2. Im Verlauf nach "Failed to connect to github.com" suchen: mehrere
   Läufe pro Woche enden so, ohne dass etwas am Repo wäre.

# Hinweis zur Ursache

Die Netzwerkaufrufe zu GitHub kennen keinen zweiten Versuch. In
`lib/workspace.ts` betrifft das drei Stellen, die alle sofort werfen:

- Zeile 190 — `clone failed`
- Zeile 197 — `fetch failed`
- Zeile 397 — `default branch unknown` (das `ls-remote` in
  `defaultBranch`)

Für den Push gibt es dieses Muster bereits: bug-017 hat dort einen
einzelnen Wiederholversuch eingebaut, samt der Unterscheidung, WANN ein
Fehler überhaupt wiederholenswert ist. Dasselbe Vorgehen passt hier —
bitte an dem bestehenden Code orientieren, statt einen zweiten Mechanismus
danebenzustellen.

Wichtig dabei, damit die Wiederholung nicht schadet:

- **Nur bei Netzwerkfehlern wiederholen.** "Could not connect",
  "Connection timed out", "Could not resolve host" sind Kandidaten. Ein
  fehlender Zugang, ein unbekanntes Repo oder ein abgelehnter Token
  werden beim zweiten Mal genauso scheitern — dort wäre die Wiederholung
  nur verlorene Zeit.
- **Genau ein zweiter Versuch**, mit kurzer Pause davor. Mehr Versuche
  verlängern bei einer echten Störung nur den Stillstand.
- Der Timeout beim Verbindungsaufbau liegt derzeit bei über zwei Minuten
  (134 Sekunden im Beispiel). Zusammen mit einem zweiten Versuch wären
  das über vier Minuten pro Repo. Prüfen, ob sich die Wartezeit
  vernünftig kürzen lässt — ein GitHub, das nach 10 Sekunden nicht
  antwortet, antwortet meist auch nach zwei Minuten nicht.

Ein Repro-Test sollte den Fehlertext oben verwenden und festhalten, dass
bei einem Netzwerkfehler ein zweiter Versuch stattfindet, bei einem
Zugangsfehler dagegen nicht.
