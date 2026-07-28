---
id: bug-017
app: appbaua
req: req-006
priority: normal
created: 2026-07-28
---

# Observed

Ein fertig abgearbeiteter Schritt geht verloren, wenn in der Zwischenzeit
jemand anderes auf denselben Branch gepusht hat:

```
Push fehlgeschlagen (LivingGardenTwin): push failed:
 ! [rejected]        main -> main (fetch first)
hint: Updates were rejected because the remote contains work that you do
hint: not have locally.
```

Belegt am 28.07.: Der Worker-Lauf startete 19:00 und wollte 19:26 pushen.
Dazwischen lag ein Commit des Betreibers (`d858faa`, 19:43 laut
Autoren-Zeitstempel). Die Arbeit war getan, der Lauf ging trotzdem als
Fehler aus.

# Expected

Der Worker verliert eine fertige Arbeit nicht, nur weil der Branch
inzwischen weitergezogen ist. Er holt den neuen Stand, setzt seinen
Commit darauf und pusht erneut.

Kein blindes Erzwingen: Ein `push --force` würde fremde Commits
überschreiben. Und bei einem echten Konflikt (beide haben dieselben
Zeilen geändert) entscheidet der Worker nicht, wer gewinnt — dann bleibt
es beim Fehler.

# Steps

1. Einen Worker-Lauf auf einem Repo starten.
2. Während der Lauf arbeitet, selbst auf denselben Branch pushen.
3. Der Push des Workers wird mit "fetch first" abgelehnt, der Lauf endet
   als Fehler.

# Ursache

`commitAndPush` in `lib/workspace.ts` pusht genau einmal und gibt bei
jedem Fehlschlag auf. Der Worker beginnt einen Schritt mit
`reset --hard origin/<branch>`, arbeitet dann Minuten bis zu einer Stunde
— in dieser Zeit kann der Branch weiterziehen. Sein Commit sitzt dann auf
einem veralteten Stand, und git lehnt zu Recht ab.

Das ist kein Fehlverhalten von git, sondern eine fehlende Behandlung:
Zwei Autoren am selben Branch sind bei diesem Repo-Setup normal.

# Behoben am 2026-07-28

`commitAndPush` versucht es bei einer Ablehnung wegen veralteten Stands
GENAU EINMAL erneut: `fetch origin <branch>`, `rebase origin/<branch>`,
dann nochmal pushen. Der Verlauf vermerkt es
("auf main gepusht (nach Rebase auf den neuen Remote-Stand)").

Bewusst eng gefasst:

- **Nur bei veraltetem Stand.** `isStaleBranchPush` erkennt "fetch first",
  "non-fast-forward" und "tip of your current branch is behind". Ein
  fehlender Token-Scope oder ein geschützter Branch wird NICHT wiederholt
  — ein Rebase ändert daran nichts, der zweite Push scheiterte identisch.
- **Rebase, nicht Merge.** Der Worker-Commit ist der einzige lokale;
  ihn auf die neue Spitze zu setzen hält die Historie linear und erzeugt
  keinen Merge-Commit, den niemand wollte.
- **Genau ein Versuch.** Bei einem Branch, auf den ständig gepusht wird,
  würde ein wiederholter Retry endlos drehen statt den Schritt zu beenden.
- **Konflikt bricht ab.** `rebase --abort`, damit die Arbeitskopie nicht
  mitten im Rebase liegen bleibt und der nächste Schritt sie brauchen
  kann. Gemeldet wird die ursprüngliche Ablehnung.

Getestet in `lib/workspace.test.ts` (6 Fälle, u.a. Konflikt-Abbruch und
"kein zweiter Retry"). Gegenprobe gemacht: Mit ausgehebelter
Stale-Erkennung fallen drei der Tests um.
