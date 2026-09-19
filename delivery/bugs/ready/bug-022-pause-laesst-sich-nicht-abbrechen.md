---
id: bug-022
app: appbaua
req: req-029
priority: normal
created: 2026-09-19
---

# Observed

Eine laufende Pause lässt sich nicht abbrechen, und die Anzeige sagt dann
etwas Falsches.

Am 19.09. lief die Anmeldung ab. Der Worker pausierte daraufhin bis 23:15
(sechs Stunden, bug-019) — richtig so. Nach dem `claude login` sollte er
nicht bis dahin warten, also wurde `pause_until` in der Datenbank
geleert.

Der Worker arbeitete danach **nicht** weiter. Stattdessen zeigte die
Oberfläche „Leerlauf — nichts zu tun", obwohl zwei Requirements in
`ready/` lagen (req-070, req-071 in Wegfara). Neun Minuten lang kein
einziger Lauf.

# Expected

Zweierlei:

1. Ein geleertes `pause_until` beendet die Pause. Der Worker nimmt beim
   nächsten Schleifendurchgang die Arbeit wieder auf.
2. Solange er pausiert, zeigt die Oberfläche das auch — nicht „nichts zu
   tun". „Nichts zu tun" heißt: Queue leer. Das war hier nicht der Fall.

Dasselbe gilt für den Hauptschalter: Wird er während einer langen Pause
aus- und wieder eingeschaltet, soll der Worker das bemerken.

# Steps

1. Eine lange Pause auslösen (abgelaufene Anmeldung: 6 Stunden;
   Rate-Limit: bis zum Reset).
2. `pause_until` in der Datenbank auf NULL setzen.
3. Der Worker schläft unverändert weiter, zeigt aber „nichts zu tun".

# Hinweis zur Ursache

`lib/worker-loop.ts`, Zeile ~323:

```ts
const untilMs = Math.max(result.pauseUntil, deps.now().getTime());
await deps.setPauseUntil(until, result.pauseReason ?? ...);
await deps.sleep(untilMs - deps.now().getTime());   // <- hier
await deps.setPauseUntil(null);
```

Der Worker schläft **im Prozess** bis zum berechneten Zeitpunkt. Die
Wartezeit steht fest, sobald `sleep` beginnt — was danach in der
Datenbank passiert, erreicht ihn nicht. `pause_until` ist also nur die
ANZEIGE der Pause, nicht ihre Quelle.

Das erklärt auch die falsche Meldung: Nach dem Leeren war die Anzeige
weg, der Schlaf aber nicht. Die Oberfläche hat dann auf „nichts zu tun"
zurückgefallen — die Standardaussage, wenn kein Grund hinterlegt ist.

Derselbe Mechanismus betrifft die 5-Minuten-Pause (Zeile ~332), dort
fällt es nur nicht auf.

Richtung für den Fix — bitte selbst abwägen:

Statt einmal lang zu schlafen, in kurzen Abschnitten schlafen (etwa 20–30
Sekunden) und zwischen den Abschnitten nachsehen, ob `pause_until` noch
gilt und ob der Hauptschalter noch an ist. Ist die Pause weg, sofort
weitermachen.

Zu prüfen ist dabei, dass die Pause nicht durch die eigene
`setPauseUntil`-Schreiberei überschrieben wird: Die Prüfung muss den
Wert lesen, den ein Mensch gesetzt (oder geleert) hat, nicht den eigenen.

# Out of Scope

- Ein eigener Knopf „Pause abbrechen" in der Oberfläche. Der Bug
  betrifft die Wirkung eines geleerten `pause_until`; ob es dafür einen
  Knopf geben soll, ist eine eigene Frage.
- Die Länge der Pausen selbst (6 Stunden bei Anmeldung, bis zum Reset
  bei Rate-Limit). Die sind richtig gewählt.
