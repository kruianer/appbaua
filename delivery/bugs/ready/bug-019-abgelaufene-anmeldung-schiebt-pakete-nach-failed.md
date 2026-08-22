---
id: bug-019
app: appbaua
req: req-029
priority: high
created: 2026-08-22
---

# Observed

Als die Claude-Anmeldung des Workers ablief, wanderte jedes Paket, das er
danach anfasste, nach `failed/` — obwohl an den Paketen nichts falsch
war. Er kam nie bis zur Arbeit, schon die Anmeldung scheiterte.

```
Claude-Lauf: Claude-Lauf fehlgeschlagen: Failed to authenticate:
OAuth session expired and could not be refreshed
 — bug-039-ds07-schaltbar-ohne-strom.md nach failed/ verschoben
```

Am 22.08. betroffen (livinggardentwin): `bug-039`, `req-034`, `req-035`.
Ab 09:25 UTC lief jeder Versuch in denselben Fehler, im Abstand von
Minuten immer wieder — auch dasselbe Paket mehrfach (bug-039 um 12:11,
12:27, 14:51, 14:56).

Belegt aus `/claude-home/.claude/.credentials.json` im Container:

```
accessToken            = leer (0 Zeichen)
refreshToken           = leer (0 Zeichen)
refreshTokenExpiresAt  = 2026-08-22T05:44:38Z   <- abgelaufen
```

Erster Fehlschlag um 09:25 UTC, also nach diesem Zeitpunkt.

# Expected

Eine abgelaufene Anmeldung ist kein Fehlschlag des Pakets — genauso wenig
wie ein Rate-Limit (req-029). Erwartet:

1. Die .md bleibt in `ready/`, sie wird NICHT nach `failed/` verschoben.
2. Der Worker pausiert, statt im Minutentakt weiterzuprobieren.
3. Im Verlauf steht ein klarer, handlungsleitender Eintrag statt einer
   technischen Fehlermeldung — sinngemäß: "Anmeldung abgelaufen. Bitte
   `docker exec -it <worker> claude /login` ausführen." Der Nutzer soll
   nicht aus einer OAuth-Meldung ableiten müssen, was zu tun ist.

Zusätzlich wünschenswert (gern als eigener Schritt, wenn es den Bug zu
groß macht): Vor dem Ablauf warnen. `refreshTokenExpiresAt` steht im
Klartext in der Credentials-Datei; ein Hinweis im Verlauf ein paar Tage
vorher würde den Stillstand ganz vermeiden.

# Steps

1. Worker laufen lassen, bis die OAuth-Anmeldung abläuft (oder die
   Credentials-Datei entsprechend manipulieren).
2. Ein Paket in `ready/` legen.
3. Der Lauf scheitert, das Paket liegt in `failed/`, und beim nächsten
   Durchlauf passiert dasselbe mit dem nächsten Paket.

# Hinweis zur Ursache

req-029 hat diesen Mechanismus für Rate-Limits bereits gebaut: erkennen,
NICHT nach `failed/` verschieben, pausieren, Leerlauf-Eintrag mit Grund.
Hier fehlt dieselbe Behandlung für Authentifizierungsfehler.

Ansatzpunkt ist vermutlich `lib/rate-limit.ts` (Muster-Erkennung) plus
die Stelle in `lib/execute-step.ts`, die über `failed/` entscheidet —
dort, wo der Rate-Limit-Fall schon abgefangen wird. Bitte
reproduce-first: erst einen Test, der mit dem exakten Meldungstext oben
den heutigen Weg nach `failed/` festhält, dann den Fix.

Die Pausendauer ist hier anders als beim Rate-Limit: Ein Rate-Limit endet
von selbst, eine abgelaufene Anmeldung nicht — sie braucht den Nutzer.
Eine kurze Wiederholung ist also sinnlos; sinnvoller ist eine lange Pause
(oder ein Anhalten, bis der Nutzer eingreift), damit der Verlauf nicht mit
identischen Fehlern volläuft.
