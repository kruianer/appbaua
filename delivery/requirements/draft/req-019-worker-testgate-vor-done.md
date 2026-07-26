---
id: req-019
title: Worker meldet erst 'done', wenn die volle Test-Suite grün ist
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-26
---

# Goal (Why)

Ich will mich darauf verlassen können, dass ein vom Worker als "fertig"
(done/) gemeldetes Requirement wirklich fertig ist — also mit grüner
Test-Suite. Zuletzt hat der Worker ein Requirement nach done/ verschoben,
obwohl die Tests rot waren (fehlende Dependency), was erst bei der
Promotion auffiel.

# Function (What)

Bevor der Worker ein datei-getriebenes Requirement als erledigt meldet
(die .md nach done/ verschiebt), muss die vollständige Test-Suite grün
sein — immer, ohne Ausnahme für vermeintlich reine Text-/Doku-Änderungen.

Ablauf am Ende eines Requirement-Laufs:
1. Der Worker führt die vollständige Test-Suite aus (Befehl aus
   delivery/stack.md).
2. Ist sie grün, gilt das Requirement als fertig → .md nach done/.
3. Ist sie rot, versucht der Worker im selben Lauf, die Ursache zu
   beheben und die Tests grün zu machen. Gelingt das → done/.
4. Bleibt die Suite nach dem Fix-Versuch rot, gilt das Requirement als
   NICHT fertig: die .md wandert nach failed/ (nicht done/), und der
   Verlauf zeigt den Fehlschlag mit der Ursache.

Dabei zählt der Zustand aus einem frischen Checkout, nicht nur die lokale
Worker-Umgebung: neue Laufzeit-Abhängigkeiten müssen in der package.json
deklariert sein, nicht nur lokal installiert.

# Acceptance Criteria

- [ ] Given der Worker hat ein Requirement umgesetzt und die volle
  Test-Suite ist grün, when der Lauf endet, then liegt die .md in done/.
- [ ] Given nach dem Umsetzen ist die Test-Suite rot und der Worker kann
  sie im selben Lauf grün machen, when der Lauf endet, then ist die Suite
  grün und die .md liegt in done/.
- [ ] Given nach dem Umsetzen ist die Test-Suite rot und der Worker kann
  sie im selben Lauf NICHT grün machen, when der Lauf endet, then liegt
  die .md in failed/ (NICHT in done/) und der Verlauf nennt den
  Fehlschlag.
- [ ] Given ein Requirement bringt eine neue Laufzeit-Abhängigkeit mit,
  when der Worker es als fertig meldet, then ist diese Abhängigkeit in
  der package.json deklariert (ein frischer Checkout mit Installation
  läuft grün), nicht nur in der lokalen Worker-Umgebung installiert.
- [ ] Given eine Änderung, die der Worker für reine Text-/Doku-Änderung
  hält, when er sie fertig melden will, then läuft trotzdem zuerst die
  volle Test-Suite (keine Ausnahme vom Test-Gate).

# Out of Scope

- Änderung der Test-Befehle oder der Testpolicy selbst (stehen in
  delivery/stack.md).
- Das Verhalten wiederkehrender Analyse-Tasks ohne .md (Code-Review,
  Security, Doku), die kein done/ kennen — hier geht es um
  datei-getriebene Requirements.
- Die konkreten aktuell roten Tests (playwright-core, Dashboard-Zähler) —
  die sind als bug-006/bug-007 erfasst.
