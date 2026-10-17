---
id: bug-025
app: appbaua
req: req-022
priority: normal
created: 2026-10-17
---

# Observed

Die Liste "Nächste Aktivitäten" im Menüpunkt Aktivität zeigt fast nur
wiederkehrende Arbeiten (Security, Doku, Ideen, Code-Review). Was
eigentlich interessiert — welche Requirements und Bugs aus den Repos als
nächstes dran sind — geht darin unter.

Außerdem stimmt die Reihenfolge nicht mit der Arbeitsweise überein, die
erwartet wird.

# Expected

Die Liste zeigt ausschließlich die wartenden Requirements und Bugs aus
den Repos. Wiederkehrende Aufgaben stehen NICHT darin — sie sind im
Verlauf nachlesbar und stören hier nur.

Die Reihenfolge geht Task-Typ außen, Repo innen: erst durch alle Repos
mit Bugs, dann durch alle Repos mit Requirements, und so weiter. Die
Reihenfolge der Repos richtet sich nach ihrer eingestellten Priorität,
die Reihenfolge der Task-Typen nach der Einstellung im Menüpunkt Tasks.

# Steps

1. Menüpunkt Aktivität öffnen.
2. Liste "Nächste Aktivitäten" ansehen: Sie besteht überwiegend aus
   wiederkehrenden Aufgaben.

# Hinweis zur Ursache

`planPreview` in `lib/scheduling.ts` geht in zwei Schleifen durch —
**Repo außen, Task-Typ innen** (Zeile 119/120). Erwartet ist die
umgekehrte Verschachtelung.

Dass wiederkehrende Aufgaben die Liste füllen, kommt aus `resolveMd` in
`lib/preview.ts`: Ein datei-getriebener Typ ohne wartende Datei liefert
`null` und bekommt keine Zeile, jeder andere Typ bekommt
`RECURRING_MD_LABEL` und damit immer eine. Liegt wenig in `ready/`,
bleiben fast nur die wiederkehrenden übrig.

**Noch zu entscheiden** (bitte selbst abwägen, nicht raten): Soll die
Liste pro Repo nur die älteste wartende Datei zeigen — so wie heute,
`oldestMd` — oder alle wartenden? Ohne wiederkehrende Aufgaben wird die
Liste sonst sehr kurz; mit allen wartenden Dateien zeigt sie den echten
Rückstand. Zweites erscheint näher an der Absicht ("hier sollten die req
und bugs aus den repos stehen"), ist aber eine Auslegung.

# Out of Scope

- Der Zeitpunkt der Aktualisierung. Die Liste wird nach jedem
  Worker-Durchgang neu gebaut (`worker-loop.ts`, nach Lauf und nach
  Leerlauf-Prüfung), bewusst nicht bei jedem Seitenaufruf, weil dafür
  jedes aktive Repo geklont werden muss. Sie kann also veraltet sein,
  bis der nächste Durchgang fertig ist. Das bleibt so.
- Die Anzeige der wiederkehrenden Aufgaben an anderer Stelle. Sie
  entfallen hier ganz und bekommen keinen Ersatzplatz.
