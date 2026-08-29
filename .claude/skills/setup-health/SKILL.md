---
name: setup-health
description: Legt fuer THIS project fest, woran man erkennt, dass die App wirklich funktioniert — nicht nur, dass ihre Container laufen. Klaert Datenbank, oeffentliche Erreichbarkeit, Datenfluss (z.B. Zigbee-Sensoren) und KI-Anbieter, und schreibt daraus delivery/health.md. Diese Datei liest der appbaua-Worker bei der Zustandsuebersicht (req-032); ohne sie wird die App nur oberflaechlich geprueft. Nutze diesen Skill, wenn der Nutzer festlegen oder aendern will, wie die Gesundheit dieser App ueberwacht wird (z.B. "Health-Checks einrichten", "woran merkt man dass die App laeuft", "Monitoring fuer diese App", "health.md anlegen").
---

# Gesundheits-Pruefungen des Projekts festlegen

Du hilfst dem Nutzer festzulegen, woran man erkennt, dass THIS project
wirklich funktioniert — und schreibst das Ergebnis nach
`delivery/health.md`.

Diese Datei ist ein Maschinen-Vertrag: Der appbaua-Worker liest sie bei
jeder Pruefrunde und leitet daraus ab, was er testet (req-032). Fehlt
sie, prueft er nur, ob die Container laufen — und genau das ist die
schwaechste aller Aussagen. Ein Container kann laufen, waehrend die App
nichts mehr tut.

Halte es kurz — hoechstens eine Bildschirmseite. Die Datei ist eine
Pruefliste, kein Betriebshandbuch.

Sprache: Fuehre den Dialog in der Sprache, in der der Nutzer mit dir
spricht. Ausnahme (Maschinen-Vertrag): Die Abschnitts-Ueberschriften der
`health.md`, die Schluesselwoerter in den Zeilen und der Dateiname
bleiben unveraendert, egal in welcher Sprache. Nur die Beschreibungen
dahinter wechseln die Sprache.

## Der Grundgedanke

Frag bei jeder Pruefung: **Wuerde sie anschlagen, wenn die App fuer den
Nutzer kaputt ist?** Und umgekehrt: **Wuerde sie ruhig bleiben, wenn
alles in Ordnung ist?**

Eine Pruefung, die bei einem Deploy jedes Mal anschlaegt, ist wertlos —
sie wird ignoriert. Eine Pruefung, die gruen bleibt, waehrend seit drei
Tagen keine Sensordaten mehr ankommen, ist schlimmer als keine: Sie
erzeugt Vertrauen, das nicht gerechtfertigt ist.

Deshalb gilt: **Im Zweifel weniger Pruefungen, aber aussagekraeftige.**
Was nicht in der `health.md` steht, wird nicht geprueft — und das ist
besser, als etwas Falsches zu pruefen.

## Die Pruefarten

**Container** — laeuft alles, und haengt nichts in einer
Neustart-Schleife? Braucht keine Angabe in der `health.md`, appbaua
findet die Container der App selbst. Diese Pruefung gibt es immer.

**Datenbank** — antwortet die Datenbank auf eine einfache Abfrage? Zu
klaeren: welcher Container, welche Datenbank. Faengt volle Platten und
haengende Datenbanken, die ein Container-Status nicht sieht.

**Web** — antwortet die App unter ihrer oeffentlichen Adresse mit einem
erwarteten Status? Zu klaeren: welche URL je Umgebung, welcher Status
gilt als gesund. Achtung bei Apps mit Anmeldung: Eine geschuetzte App
antwortet mit einer Weiterleitung (307/302) auf die Anmeldeseite — das
ist gesund, nicht kaputt. Faengt auch kaputte Tunnel, die ein
Container-Status nicht sieht.

**Datenfluss** — kommen frische Daten an? Der wichtigste Check fuer Apps,
die Daten von aussen empfangen (Zigbee-Sensoren, Wetterdienste,
Messgeraete). Zu klaeren: woran man das Alter des juengsten Datensatzes
erkennt, und ab wann er als zu alt gilt. Diese Frist muss aus der App
kommen — nur dort weiss man, wie oft die Quelle normalerweise sendet.

**KI-Anbieter** — antwortet der Anbieter, den diese App nutzt, auf einen
kleinen Testaufruf? Zu klaeren: welcher Anbieter, welche Umgebungsvariable
den Schluessel traegt. Jeder Aufruf kostet Geld, deshalb prueft appbaua
das viel seltener als den Rest (Vorgabe einmal pro Tag).

## Flow

### 1. Repo verstehen (bevor du fragst)

Lies, was das Repo schon hat — frag nicht nach Dingen, die dort stehen:

- `delivery/devops.md`, Abschnitt `## Environments`: Umgebungen und ihre
  URLs. Daraus ergeben sich die Web-Pruefungen.
- Die Compose-Datei(en): Welche Dienste gibt es? Namen von
  Datenbank-Containern, auffaellige Dienste (zigbee, mqtt, poller,
  worker). Das ist die beste Quelle dafuer, was diese App ueberhaupt tut.
- `delivery/stack.md`: Sprache, Datenhaltung.
- Suche nach Hinweisen auf einen KI-Anbieter (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `openai`, `anthropic`).
- Gibt es schon einen Health-Endpunkt in der App (`/api/health`,
  `/healthz`)? Dann ist er der beste Anker fuer die Web-Pruefung.

Sag dem Nutzer in zwei, drei Saetzen, was du gefunden hast, und schlage
die Pruefungen vor, die sich daraus ergeben. Er korrigiert, statt alles
selbst zusammentragen zu muessen.

### 2. Hoechstens drei Fragen

Stell nur, was du nicht lesen konntest und was das Ergebnis aendert. Mit
Optionen und einer kurz begruendeten Empfehlung.

Die Frage, die fast immer noetig ist:

- **Ab wann sind Daten zu alt?** Nur bei Apps mit Datenfluss. Frag nach
  dem normalen Abstand zwischen zwei Datensaetzen und schlag das Zwei-
  bis Dreifache als Frist vor — so schlaegt die Pruefung nicht bei einem
  einzelnen ausgelassenen Messwert an.

Weitere, falls unklar:

- **Welche Umgebungen werden ueberwacht?** (Empfehlung: beide. Ein
  kaputtes dev faellt sonst erst auf, wenn man dort arbeiten will.)
- **Soll der KI-Anbieter geprueft werden?** (Empfehlung: ja, wenn die App
  ohne ihn nicht funktioniert. Nein, wenn er nur eine Nebenfunktion
  bedient — der Aufruf kostet.)

Frag NICHT nach dem Pruefabstand oder danach, wie oft die KI geprueft
wird: Das stellt der Betreiber in appbaua ein, nicht pro App.

### 3. Schreiben

Schreib `delivery/health.md` nach der Vorlage unten. Nimm nur auf, was
wirklich geprueft werden kann — lieber drei belastbare Pruefungen als
sechs geratene.

Verlinke die Datei aus der `CLAUDE.md` des Repos (Abschnitt "Health"
oder bei den uebrigen Vorgabedateien), damit sie auffindbar bleibt.

### 4. Uebergeben

Sag in ein, zwei Saetzen, welche Pruefungen jetzt gelten. Weise auf das
hin, was zutrifft:

- Die Pruefungen wirken erst, wenn das Repo in appbaua den Schalter
  "ueberwachen" gesetzt hat.
- Eine Pruefung, die einen Schluessel oder Zugang braucht, funktioniert
  nur, wenn appbaua an ihn herankommt.

## Vorlage

```markdown
# Health-Checks

Woran man erkennt, dass diese App funktioniert. Gelesen vom
appbaua-Worker (req-032).

## Datenbank

- Container: `<container-name>`
- Datenbank: `<db-name>`
- Benutzer: `<db-user>`

## Web

- dev: `<url>` erwartet `<status>`
- prod: `<url>` erwartet `<status>`

## Datenfluss

- Beschreibung: <was hier ankommt, z.B. "Zigbee-Sensorwerte">
- Woran erkennbar: <Tabelle und Spalte mit dem Zeitstempel, oder
  Endpunkt, der das Alter nennt>
- Zu alt ab: <Dauer, z.B. "30 Minuten">

## KI-Anbieter

- Anbieter: <openai | anthropic | ...>
- Schluessel aus: `<UMGEBUNGSVARIABLE>`

## Nicht pruefen

- <Dienste, die absichtlich stillstehen duerfen, mit Begruendung>
```

Abschnitte, die auf diese App nicht zutreffen, laesst du weg — eine
leere Ueberschrift ist schlechter als keine, weil sie aussieht wie eine
vergessene Angabe.

## Was du NIE tust

- Eine Pruefung erfinden, deren Ergebnis du nicht erklaeren kannst. Wer
  nicht sagen kann, warum eine Pruefung rot wird, kann auch nicht darauf
  reagieren.
- Eine Frist raten, weil der Nutzer sie nicht auf Anhieb weiss. Frag nach
  dem normalen Abstand zwischen zwei Datensaetzen und rechne daraus.
- Zugangsdaten, Schluessel oder Passwoerter in die `health.md`
  schreiben. Dort stehen nur die NAMEN der Umgebungsvariablen.
- Die Web-Pruefung einer geschuetzten App auf Status 200 festlegen. Eine
  Anmeldeseite antwortet mit einer Weiterleitung, und die ist gesund.
- Dienste in die Pruefung aufnehmen, die absichtlich nur zeitweise
  laufen (Cron-artige Jobs, abgeschaltete Worker). Sie gehoeren unter
  "Nicht pruefen", mit Begruendung.
- Die `health.md` fuer ein fremdes Repo schreiben. Sie gehoert in das
  Repo der App, deren Gesundheit sie beschreibt.
