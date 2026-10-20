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

# Behoben am 2026-09-19

`pause_until` ist jetzt die QUELLE der Pause, nicht mehr nur ihre
Anzeige. Der Worker schläft eine Pause nicht mehr in einem Stück,
sondern in Abschnitten von 20 Sekunden (`PAUSE_POLL_MS` in
`lib/worker-loop.ts`) und sieht zwischen den Abschnitten nach, ob sie
noch gilt (`sleepThroughPause`).

**Die eigene Schreiberei zählt nicht als Eingriff.** Der Wert, den der
Worker beim Beginn der Pause selbst geschrieben hat, ist der Maßstab:
Nur eine Abweichung davon — geleert, verkürzt, verschoben — ist ein
Mensch, und dann endet die Pause sofort. Verglichen wird der ZEITPUNKT
(mit einer Sekunde Toleranz), nicht der Text: der Wert läuft durch
Postgres (`timestamptz`) und kann anders formatiert zurückkommen.

**Der Hauptschalter wird mitgelesen.** Aus und wieder an während einer
Pause beendet sie ebenfalls. Nur aus beendet sie nicht — dann wartet der
Worker weiter, und der nächste Durchgang prüft den Schalter ohnehin.

**Eine Pause, die ein Mensch gesetzt hat, wird nicht überschrieben.**
Der abschließende `setPauseUntil(null)` passiert nur, wenn das
gespeicherte Fenster noch das eigene ist. Ein Lesefehler am Store
(DB-Aussetzer) kürzt die Pause nicht ab — unlesbar gilt als unverändert,
der nächste Abschnitt sieht erneut nach.

Damit stimmt auch die Anzeige wieder: Der Worker schläft genau so lange,
wie das gespeicherte Fenster sagt, also kann die Startseite nicht mehr
auf „Leerlauf — nichts zu tun" zurückfallen, während er in Wahrheit noch
wartet. Das war die zweite Hälfte des Bugs.

Gilt für alle Pausen gleichermaßen — Rate-Limit, abgelaufene Anmeldung,
Netzabbruch und die 5-Minuten-Pause des leeren Durchgangs. An den
Längen selbst ist nichts geändert (Out of Scope), nur an ihrer
Unterbrechbarkeit.

Sechs Tests in `lib/worker-loop.test.ts` (eigener Block „laufende Pause
lässt sich abbrechen"), dazu ein Prüfstand, der die Pause wirklich
durchlebt: die Uhr läuft mit jedem Abschnitt weiter, und das Fenster
geht durch den echten Worker-Status-Store — denselben Wert, den ein
Mensch in der Datenbank ändert. Gegenprobe gemacht: mit dem alten langen
Schlaf fallen fünf der sechs um, darunter die Anzeige, die dann wieder
„idle" statt „pause" meldet.
