---
id: req-999
title: Worker-Selbsttest (harmlos)
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-24
---

# Goal (Why)

Ein bewusst minimaler, ungefährlicher Task, um den autonomen Worker
(req-006) das erste Mal an appbaua selbst zu erproben.

# Function (What)

Lege im Repos-Wurzelverzeichnis eine Datei `WORKER-SELFTEST.md` an (oder
ergänze sie, falls vorhanden) mit genau einer neuen Zeile im Format:

`Selbsttest OK — <aktuelles Datum/Uhrzeit>`

Sonst nichts. Keine anderen Dateien ändern, keine Abhängigkeiten, keine
Tests nötig.

# Acceptance Criteria

- [ ] Given der Worker arbeitet diese Datei ab, when er fertig ist, then
  existiert im Repo-Wurzelverzeichnis die Datei `WORKER-SELFTEST.md` mit
  einer Zeile, die mit "Selbsttest OK" beginnt.
- [ ] Given der Lauf ist fertig, when man den dev-Branch ansieht, then
  wurde NUR `WORKER-SELFTEST.md` hinzugefügt/geändert und sonst keine
  Datei.

# Out of Scope

- Jede andere Änderung am Repo.
