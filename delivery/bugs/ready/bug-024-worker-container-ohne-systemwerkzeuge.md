---
id: bug-024
app: appbaua
req: req-006
priority: high
created: 2026-10-10
---

# Observed

Die Läufe dauern seit einiger Zeit sehr lange — 42 bis 120 Minuten je
Paket. Ein Blick auf die Live-Ausgabe zeigt, womit die Zeit vergeht:

```
→ Bash: export PATH="/tmp/perlroot/usr/bin:..." LD_LIBRARY_PATH="/tmp/perlroot/usr/lib/perl5/core_perl/CORE"
→ Bash: export PERL5LIB="/tmp/perlroot/usr/share/perl5/core_perl/..."
→ Bash: ... exiftool-vendored.pl@13.59.3/node_modules/exiftool-vendored.pl/bin/exiftool
```

Claude baut sich mitten im Lauf eine Perl-Umgebung nach `/tmp/perlroot`,
weil `exiftool` und `perl` im Container fehlen. Bei Knipsa (Bildarchiv)
braucht es sie für Aufnahmezeit, GPS und Stichwörter aus den Fotos.

Von zehn Läufen über 40 Minuten in den letzten sieben Tagen ringen
**sieben** mit fehlenden Systemwerkzeugen.

Im Container nachgesehen — alle elf geprüften Werkzeuge fehlen:

```
perl FEHLT · python3 FEHLT · exiftool FEHLT · make FEHLT · gcc FEHLT
g++ FEHLT · ffmpeg FEHLT · imagemagick FEHLT · convert FEHLT
sqlite3 FEHLT · jq FEHLT
```

Erschwerend: Was Claude nach `/tmp` baut, ist beim nächsten Lauf wieder
weg. Dieselbe Arbeit beginnt von vorn.

**Wellarita ist der schwerere Fall.** Es ist kein Node-Projekt, sondern
hat ein Python-Backend — `delivery/stack.md` nennt als Testbefehl:

```
- Install: cd backend && pip install -e ".[dev]"
- Test:    cd backend && pytest · cd frontend && npm test
```

Im Container fehlt davon **alles**: `python3`, `python`, `pip`, `pip3`,
`pytest`. Claude muss also vor jeder Etappe erst eine
Python-Umgebung beschaffen, bevor es überhaupt einen Test fahren kann.
Das erklärt die Läufe von 42 bis 120 Minuten in diesem Repo.

Anders als bei Knipsa reicht hier kein einzelnes Werkzeug: Ein
Python-Projekt mit Rechenbibliotheken braucht `python3`, `py3-pip` und
die Übersetzungswerkzeuge — numpy und Verwandte liegen für musl selten
vorgefertigt vor.

# Expected

Der Worker-Container bringt die Werkzeuge mit, die die betreuten Repos
brauchen. Claude setzt ein Requirement um, statt zuerst eine
Laufzeitumgebung nachzubauen.

# Steps

1. Ein Requirement in einem Repo bearbeiten lassen, das Bildmetadaten,
   native Module oder Python braucht (z.B. Knipsa req-005 bis req-007).
2. Live-Ausgabe ansehen: Der Lauf beginnt mit dem Nachrüsten von
   Abhängigkeiten, nicht mit der Aufgabe.

# Hinweis zur Ursache

`Dockerfile.worker` installiert heute `bash git openssh chromium nss
freetype harfbuzz ttf-freefont` — gewachsen aus bug-016 (bash fehlte)
und req-017 (Chromium für Screenshots). Jedes neue Repo bringt neue
Anforderungen mit, und bisher hat sie keiner nachgetragen.

**Was NICHT die Ursache ist** (geprüft, damit es nicht noch einmal
untersucht wird): Das Test-Gate. Gemessen im laufenden prod-Container:

```
npm test     19 Sekunden (899 Tests)
npm install  10 Sekunden
```

Unter 30 Sekunden je Etappe. Selbst bei zehn Etappen sind das drei
Minuten von 60 bis 80 — also unter 5%. Die Etappen aus req-036 sind
nicht das Problem.

Richtung für den Fix — bitte selbst abwägen:

Die Werkzeuge in die `apk add`-Zeile von `Dockerfile.worker` aufnehmen.
Belegt sind:

- `perl` und `exiftool` — Knipsa, Bildmetadaten
- `python3`, `py3-pip` — Wellarita, das Backend ist Python
- `make`, `gcc`, `g++`, `python3-dev`, `musl-dev` — zum Übersetzen
  nativer Module und von pip-Paketen ohne musl-Fassung

Jedes Paket kostet Platz im Image und Zeit beim Bauen. Was nicht belegt
ist (`ffmpeg`, `imagemagick`, `sqlite3`, `jq`), gehört erst hinein, wenn
ein Repo es tatsächlich verlangt.

Zu bedenken: Alpine nutzt musl statt glibc. Native Node-Module, die
vorgefertigte Binärdateien mitbringen, finden dort oft keine passende
Fassung und müssen übersetzt werden — dafür braucht es `make`, `gcc`,
`g++` und `python3`. Das ist der Grund, warum diese vier zusammengehören.

# Out of Scope

- Ein Weg, auf dem ein Repo seine Systemabhängigkeiten selbst ansagt —
  das ist req-039 und löst das Problem dauerhaft. Dieser Bug behebt nur,
  was heute nachweislich fehlt.
- Ein Wechsel der Container-Grundlage von Alpine auf Debian. Wäre eine
  Möglichkeit, wenn sich musl als dauerhaftes Hindernis erweist, ist aber
  ein größerer Eingriff und gehört entschieden, nicht nebenbei gemacht.
