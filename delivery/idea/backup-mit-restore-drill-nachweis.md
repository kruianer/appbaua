---
titel: "Backup mit Restore-Drill-Nachweis"
datum: 2026-07-30
---

## Problem/Nutzen

appbaua speichert seinen gesamten Zustand — Repo-Konfiguration,
Task-Typen, Requirements- und Bug-Verlauf, Worker-Historie, Auth-Daten —
in einer Postgres-Datenbank im Docker-Volume `db-data`. Für dieses
Volume existiert heute **kein** automatisierter Dump- oder
Snapshot-Mechanismus; der jüngste Security-Bericht
(`delivery/security/2026-07-29-security-appbaua-543058e.md`, Finding 3)
bestätigt das ausdrücklich als offene Lücke. Geht der Datenträger des
Beelink verloren oder defekt, ist der komplette Verlauf ersatzlos weg —
für einen Worker, der unbeaufsichtigt läuft und dem man vertrauen soll,
ist das ein Widerspruch zum Anspruch "rock-solid" und "public-ready".

Ein reines "es läuft nun ein nächtlicher `pg_dump`"-Cronjob würde die
Lücke technisch schließen, aber genau das Muster wiederholen, das die
Idee [Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md) für Quality
Gates schon als riskant beschreibt: ein Mechanismus, der niemand
beweist, dass er wirklich funktioniert. Ein Backup, das seit Wochen
stillschweigend fehlschlägt oder eine leere/korrupte Datei erzeugt,
sieht von außen exakt so aus wie ein gutes Backup — bis zum Ernstfall,
wenn es zu spät ist.

Nutzen:

- **Rock-solid Qualität** — der Worker übersteht nicht nur Code-Bugs,
  sondern auch den Verlust der eigenen Datenbasis, ohne bei null
  anzufangen.
- **Verlässlichkeit durch Nachweis statt Behauptung** — nicht "ein
  Backup lief", sondern "ein Backup lief **und** ließ sich nachweislich
  wiederherstellen".
- **Nachvollziehbarkeit** — der Nutzer sieht auf einen Blick, wann das
  letzte belegt funktionierende Backup war, statt das erst im Ernstfall
  herauszufinden.

## Skizze

**Kern:** Ein neuer, periodischer Hintergrund-Job (unabhängig von den
bestehenden Task-Typen, da er den Worker selbst betrifft statt ein
bearbeitetes Repo) zieht einen `pg_dump` des `db-data`-Volumes auf ein
zweites Medium (z. B. ein separates Verzeichnis/Volume außerhalb des
DB-Containers, optional zusätzlich extern gesichert). Direkt im
Anschluss folgt der eigentliche Kern der Idee, der **Restore-Drill**:
der frische Dump wird in eine Wegwerf-Datenbank (temporärer
Docker-Container, eigener Compose-Service oder Testschema) eingespielt
und gegen eine einfache Prüfsumme validiert — z. B. Tabellenanzahl,
Zeilenzahl der wichtigsten Tabellen, oder ein leichter `SELECT count(*)`
je Kerntabelle im Vergleich zur Quelle. Erst wenn der Restore
nachweislich gelingt, gilt der Durchlauf als grün. Die Wegwerf-Instanz
wird danach sofort wieder verworfen.

**Darstellung — Backup-Status-Kachel:** eine kompakte Kachel (z. B. auf
dem Dashboard neben den bestehenden System-Monitor-Kacheln, req-009),
die den Zustand ehrlich in drei Stufen zeigt statt binär grün/rot:

```
🛡 Backup
   ✓ zuletzt erfolgreich wiederhergestellt   heute, 03:47 Uhr
   Dump-Größe 4,2 MB · 18 Tabellen · Drill-Dauer 6 s
```

Bei Fehlschlag wird daraus sichtbar zwischen zwei Fällen unterschieden,
die für den Nutzer sehr unterschiedlich dringlich sind:

```
⚠ Backup
   ✗ Dump lief, Restore-Drill fehlgeschlagen   seit 2 Tagen
   letzter belegter Stand: 2026-07-28, 03:41 Uhr
```

```
– Backup
   nicht ausgeführt — Job lief noch nie
```

**Ehrlichkeits-Regel (analog zum Schritt-Beleg-Gedanken):** "nicht
ausgeführt" ist ein eigener grauer Zustand, der nie zu grün geglättet
wird; ein Dump ohne bestandenen Restore-Drill zählt nicht als
erfolgreiches Backup.

**Frequenz & Aufbewahrung:** täglich, außerhalb der aktiven
Task-Zeitfenster; die letzten N Dumps rotierend behalten (Anzahl/Ablage
wäre vor Umsetzung zu klären — lokal auf dem Beelink reicht als Start,
ein externes Ziel ist ein möglicher, aber separat zu entscheidender
Ausbauschritt).

**Abgrenzung:** Reine Infrastruktur- und Sicht-Ebene, kein Eingriff in
die Auswahl-Logik oder Task-Typen des Workers und kein Aufweichen des
Human-Gates. Betrifft ausschließlich die appbaua-eigene Datenbank, nicht
die von appbaua bearbeiteten Fremd-Repos. Konkreter Speicherort des
Zweitmediums, Rotationstiefe und ob/wie ein externes Ziel angebunden
wird, sind bewusst offen gelassen und vor Umsetzung zu bestätigen, nicht
stillschweigend vorauszusetzen.
