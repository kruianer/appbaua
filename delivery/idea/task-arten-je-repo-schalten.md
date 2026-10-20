---
titel: Task-Arten je Repo schalten statt global
datum: 2026-10-18
---

## Problem/Nutzen

Die Schalter im Menüpunkt "Tasks" gelten für alle Repos gemeinsam: Die
Tabelle `task_types` kennt `active`, `always` und `schedule`, aber
keinen Repo-Bezug. Wer "Doku" abschaltet, schaltet sie überall ab.

Bisher stört das nicht — Security, Code-Review und Doku sind in jedem
Repo sinnvoll. Mit req-047 (Selbstauftrag) entstand die erste Task-Art,
die ausdrücklich nur für ein einziges Repo gelten soll; sie bekommt
deshalb eine eigene Einstellung am Repo.

Damit gibt es künftig zwei Wege, dasselbe zu steuern: die globalen
Schalter unter "Tasks" und Einstellungen am Repo (Modell aus req-028,
Wochenbudget aus req-044, Selbstauftrag aus req-047). Je mehr davon
dazukommen, desto weniger ist erkennbar, wo etwas eingestellt wird.

Der Nutzen einer Vereinheitlichung: Ein Repo, das keine Doku braucht,
bekommt keine; eines, das nur nachts geprüft werden soll, bekommt seine
eigenen Zeiten. Und es gäbe nur noch einen Ort je Frage.

## Skizze

Je Repo eine Abweichung vom globalen Standard — nicht eine vollständige
zweite Konfiguration, sondern nur, was abweicht. Die globalen Schalter
blieben die Vorgabe; ein Repo kann einzelne Task-Arten für sich
abschalten oder anders takten.

In der Repo-Verwaltung erschiene das dort, wo heute Modell und
Wochenbudget stehen. Unter "Tasks" bliebe die globale Sicht, ergänzt um
den Hinweis, in wie vielen Repos eine Task-Art abweichend eingestellt
ist.

Zu bedenken: Der Betreiber hat diese Vereinheitlichung am 18.10.
ausdrücklich zurückgestellt — "auf Dauer schon, jetzt lassen wir es".
Sie lohnt erst, wenn mehr als eine Task-Art je Repo zu steuern ist.
