---
id: req-015
title: UI-Feinschliff — .md-Name im Verlauf, getönter Header, neues Logo
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
changes: req-004, req-008
---

# Goal (Why)

Drei kleine Verbesserungen an der Oberfläche: Ich will im Verlauf auf
einen Blick sehen, welche .md-Datei ein Lauf abgearbeitet hat (bessere
Nachvollziehbarkeit), die Kopfzeile der App soll sich farblich vom Body
abheben, und das Logo soll klarer für den autonomen Worker stehen.

# Function (What)

Drei unabhängige Anpassungen:

1. **.md-Name im Verlauf:** Jeder Verlaufs-Eintrag zeigt unter der
   Titelzeile ("Task-Typ × Repo") eine zweite Zeile mit dem Namen der
   abgearbeiteten .md-Datei — analog zur Aktivität (req-008). Dafür wird
   der .md-Name künftig am Verlaufs-Eintrag mitgespeichert. Bei
   wiederkehrenden Tasks ohne .md (Code-Review, Ideen, Security) steht
   dort "wiederkehrende Aufgabe". Alte Einträge, die den Namen nie
   gespeichert haben, zeigen keine zweite Zeile.

2. **Getönte Kopfzeile:** Der Header-Balken der App ist heute in der
   Hintergrundfarbe (`var(--color-bg)`) gehalten und hebt sich kaum ab.
   Neu erhält er einen dezent in der Akzentfarbe getönten Hintergrund
   (Akzentfarbe stark transparent über dem Hintergrund), sodass er sich
   ruhig vom Body abhebt. Der Titeltext und die Icons bleiben in ihrer
   bisherigen Farbe lesbar.

3. **Neues Logo:** Das bisherige Logo (Icon in einer Gradient-Kachel)
   wird ersetzt durch ein Zahnrad-mit-Häkchen-Symbol im Linien-Stil
   (dünne, gleichmäßige Linien, einfarbig, passend zum bestehenden
   Icon-Set) — OHNE die Hintergrundkachel/Box; das Icon steht frei im
   Header neben dem Schriftzug "appbaua".

# Acceptance Criteria

- [ ] Given der Worker hat den Lauf "Requirements × appbaua" für die
  Datei "req-020-beispiel.md" abgearbeitet, when ich den zugehörigen
  Verlaufs-Eintrag ansehe, then steht unter "Requirements × appbaua" eine
  zweite Zeile mit "req-020-beispiel.md".
- [ ] Given ein Verlaufs-Eintrag für einen wiederkehrenden Task
  (Code-Review), when ich ihn ansehe, then steht in der zweiten Zeile
  "wiederkehrende Aufgabe".
- [ ] Given ein alter Verlaufs-Eintrag, der vor dieser Änderung entstand
  und keinen .md-Namen gespeichert hat, when ich ihn ansehe, then zeigt
  er KEINE zweite Zeile (kein Platzhalter).
- [ ] Given ich öffne die App, when ich die Kopfzeile betrachte, then ist
  ihr Hintergrund erkennbar in der Akzentfarbe getönt und unterscheidet
  sich vom Body-Hintergrund.
- [ ] Given ich betrachte die Kopfzeile, when ich das Logo ansehe, then
  sehe ich ein freistehendes Zahnrad-mit-Häkchen-Symbol im Linien-Stil
  OHNE umgebende farbige Box/Kachel.

# Out of Scope

- Änderung der Aktivitäts-Anzeige (die zeigt den .md-Namen bereits,
  req-008) — hier geht es nur um den Verlauf.
- Nachträgliches Befüllen des .md-Namens für bereits bestehende
  Verlaufs-Einträge.
- Weitere Header-Umbauten (Anordnung, Tabs, Theme-Umschalter bleiben wie
  sie sind) — nur die Tönung ändert sich.
- Änderung der übrigen Icons der App — nur das Logo wird ersetzt.
