---
id: req-044
title: Wochenbudget für Arbeitspakete je Repo
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-10-17
---

# Goal (Why)

Mein Claude-Abo hat eine Obergrenze. Ein Repo, das sich seine Arbeit
selbst ausdenkt, kann sie allein aufbrauchen — dann stehen alle anderen
Repos still. Ich will je Repo festlegen können, wie viel es in einer
Woche verbrauchen darf.

# Function (What)

Jedes Repo bekommt eine Einstellung: wie viele Arbeitspakete der Worker
dort in einer Woche höchstens abarbeiten darf.

Gezählt werden Bugs und Requirements **zusammen** — es ist ein
gemeinsames Budget, kein getrenntes je Art. Wiederkehrende Aufgaben
(Security, Doku, Ideen, Code-Review) zählen nicht mit.

Ist das Budget aufgebraucht, überspringt der Worker dieses Repo für
Bugs und Requirements, bis die Woche vorbei ist. Die anderen Repos
laufen unverändert weiter. Die Pakete bleiben liegen, wo sie sind.

Ohne eingestellten Wert gilt kein Budget — bestehende Repos arbeiten
weiter wie bisher.

# Acceptance Criteria

- [x] Given ich öffne den Menüpunkt "Repos", when ich ein Repo
      aufklappe, then kann ich dort ein Wochenbudget eintragen.
- [x] Given für ein Repo ist kein Wochenbudget eingetragen, when der
      Worker läuft, then arbeitet er dort unbegrenzt viele Pakete ab.
- [x] Given für "Forschung" ist das Budget 3 und der Worker hat diese
      Woche dort 2 Pakete abgearbeitet, when ein drittes in `ready/`
      liegt, then bearbeitet er es.
- [x] Given für "Forschung" ist das Budget 3 und der Worker hat diese
      Woche dort 3 Pakete abgearbeitet, when ein viertes in `ready/`
      liegt, then bearbeitet er es NICHT.
- [ ] Given das Budget eines Repos ist aufgebraucht, when ich den
      Verlauf ansehe, then ist erkennbar, dass das Repo wegen des
      Budgets übersprungen wurde.
- [x] Given das Budget von "Forschung" ist aufgebraucht, when ein
      anderes Repo Pakete in `ready/` hat, then arbeitet der Worker
      dieses andere Repo normal ab.
- [x] Given das Budget ist mit 2 Bugs und 1 Requirement aufgebraucht,
      when ein weiterer Bug in `ready/` liegt, then bearbeitet er ihn
      NICHT — Bugs und Requirements teilen sich ein Budget.
- [x] Given das Budget eines Repos ist aufgebraucht, when der Worker
      dort einen Security-Lauf machen würde, then macht er ihn — die
      wiederkehrenden Aufgaben zählen nicht zum Budget.
- [x] Given eine neue Woche beginnt, when der Worker das Repo an die
      Reihe nimmt, then arbeitet er dort wieder Pakete ab.
- [ ] Given das Budget ist aufgebraucht, when ich im Menüpunkt "Repos"
      nachsehe, then erkenne ich, wie viel von dieser Woche verbraucht
      ist.

# Constraints

- Der Zweck ist der Schutz des Claude-Abos. Das Budget begrenzt
  deshalb, was ABGEARBEITET wird, nicht, was in `ready/` liegen darf.

# Out of Scope

- Ein Budget über alle Repos hinweg (Gesamtobergrenze). Hier geht es um
  die Begrenzung je Repo.
- Eine Begrenzung der wiederkehrenden Aufgaben (Security, Doku, Ideen,
  Code-Review). Sie laufen ohnehin höchstens einmal pro Tag.
- Eine Benachrichtigung, wenn ein Budget aufgebraucht ist.
- Ein Übertragen ungenutzter Pakete in die nächste Woche.
