---
titel: "Testumfang-Wache — Grün sagt nicht, wie viel getestet wurde"
datum: 2026-11-05
---

## Problem/Nutzen

Das Testgate (req-019/req-025) kennt für eine bestandene Suite genau ein
Bit: Exit-Code 0. `exec()` in `lib/test-gate.ts` wertet bei Erfolg die
Ausgabe gar nicht aus und gibt `null` zurück; im Verlauf steht danach nur
„Test-Suite grün: npm test". Ob dahinter 1552 Tests liefen oder 40, sieht
niemand. Für das Gate ist beides dasselbe.

Das wiegt deshalb schwer, weil der Worker die Tests, die ihn prüfen, selbst
ändern darf. Der Reparatur-Auftrag `testFixPrompt`
(`lib/claude-runner.ts`) enthält den richtigen Satz: „lösche, überspringe
oder schwäche KEINEN Test ab, nur damit er durchläuft." Überprüft wird
dieser Satz nirgends. Er ist die einzige Sicherung an genau der Stelle, an
der der Druck am größten ist: Die Suite ist rot, und Grün ist das einzige
Abbruchkriterium. Die Vision verlangt „Quality Gates nie umgehen"; ein
Worker, der einen störenden Test mit `.skip` versieht, umgeht das Gate,
und das Gate meldet Grün.

Dass der Worker das bisher getan hätte, ist nicht belegt: In der
Git-Historie seit Juli findet sich kein Commit, der Testdateien gelöscht
oder deutlich gekürzt hat, und im Code steht kein `it.skip`. Der Punkt ist,
dass es **niemand bemerken würde**. Ein harmloser Fall zeigt das schon
heute: 9 von 14 Wächter-Tests werden seit mindestens 01.09. still
übersprungen (`describe.skipIf(!PHP)` in `watchdog/watchdog.test.ts`). Das
ist nur bekannt, weil die wöchentliche Code-Review die Zahl jedes Mal von
Hand notiert. Auch die Testzahlen (782 → 1076 → 1552) stehen allein als
Fließtext in `delivery/reviews/`. Die App kennt sie nicht, und ein
Fremd-Repo in der Liste bekommt diese Zahlen womöglich nie.

Nutzen:

- **Rock-solid Qualität:** Ein Gate, das man durch Verkleinern der Suite
  bestehen kann, ist keine harte Grenze. Der Schwund fällt künftig am
  selben Tag auf, nicht erst bei einem Ausfall.
- **Nachvollziehbarkeit:** Aus „grün" wird „1543 grün, 9 übersprungen,
  3 mehr als vorher, 2 Testdateien geändert".
- **Visualisierung:** Die Testzahl je Repo wird zur Kurve; ein Knick nach
  unten ist sofort zu sehen.

## Skizze

**1. Das Gate misst den Umfang.** Bei grüner Suite liest `runTestGate` die
Zusammenfassung aus der Ausgabe, die heute schon anfällt, etwa `Tests 1543
passed | 9 skipped (1552)` (Vitest) oder `1543 passed, 9 skipped` (pytest).
Das Ergebnis wandert als optionales Feld `scope` (bestanden, übersprungen)
in `TestGateResult`. Keine Testinfrastruktur, kein zusätzlicher Lauf, kein
Eingriff in das Testkommando des Repos.

Lässt sich die Zeile nicht lesen, heißt das **„Umfang unbekannt"**, grau
und sichtbar, im Sinne der Ehrlichkeits-Regel aus req-025. Das Gate bleibt
davon unberührt.

**2. Vergleich mit der letzten Messung.** Je Repo wird die letzte Messung
gespeichert. Die Verlaufsnotiz nennt den Unterschied:

```
✓ bug-043 (Test-Suite grün: 1543 bestanden, 9 übersprungen, +3)
▲ req-052 (Test-Suite grün: 1498 bestanden, 54 übersprungen)
   Schwund gegenüber dem letzten Lauf: −45 bestanden, +45 übersprungen
```

**3. Die Reparaturrunde bekommt einen eigenen Blick.** Wurde die Suite erst
nach einem `testFixPrompt`-Durchgang grün, vermerkt der Worker aus dem Diff
dieser Runde, welche Testdateien sie geändert oder gelöscht hat. Das ist
sprachunabhängig und fängt auch den Fall, den keine Zählung sieht: ein
Test, der weiter existiert, aber nichts mehr prüft. Der Vermerk bewertet
nicht, er zeigt dem Menschen nur, wo er hinsehen sollte.

**4. Anzeige.** In der aufgeklappten Repo-Zeile (req-030) eine kleine
Stufenkurve: bestandene Tests über die letzten Läufe, übersprungene als
Fläche darunter, Schwund-Stellen als Marker mit Klick auf den Lauf.
Telegram (req-033) meldet Schwund einmal, mit Repo und Paket.

**Empfehlung zur Schärfe: anzeigen, nicht blockieren.** Weniger Tests sind
oft richtig, etwa nach dem Entfernen eines Features oder beim
Zusammenlegen von Fällen. Eine harte Sperre würde den Worker nachts
legitimer Arbeit wegen stoppen und ihn dazu anreizen, Tests zu horten.
Schwund ist deshalb ein deutlicher Hinweis, kein Fehlschlag; das Paket
landet trotzdem in `done/`. Ob es später eine einstellbare Schwelle für
„blockiert" braucht, zeigt erst die Erfahrung.

**Abgrenzung:**

- Zu [Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md): Dort geht es
  darum, ob ein Gate **gelaufen** ist, belegt aus CI und Exit-Codes. Hier
  geht es darum, ob das bestandene Gate **noch so viel prüft wie vorher**.
  Der Beleg kann „214 grün" anzeigen, vergleicht aber nicht; die Wache
  liefert ihm die Zahl und die Differenz.
- Zu [Nacharbeits-Quote](nacharbeits-quote-je-repo-und-task-art.md): Die
  misst im Nachhinein Folge-Bugs. Die Wache wirkt im selben Lauf.
- Zu [Chat-Pushes](chat-pushes-durch-testgate-und-verlauf.md): Chat-Pushes
  ändern die Testzahl mit, ohne eine Messung zu erzeugen. Ein Unterschied
  zwischen zwei Messungen kann also auch aus dem Chat stammen; die Notiz
  nennt deshalb den Commit-Bereich, statt den Schwund dem Worker
  zuzuschreiben.

**Grenzen:** Die Wache beweist keine Testqualität, und ein Lauf mit
weiterhin hoher Zahl kann trotzdem leer prüfen. Mutationstests wären die
ehrlichere Antwort, sind aber für einen nächtlichen Lauf zu teuer und
bewusst nicht Teil dieser Idee.

Das Human-Gate bleibt unberührt. Die Wache informiert und entscheidet
nichts. Datenmodell-seitig genügt eine kleine Ablage der letzten Messungen
je Repo; die Form klärt das Requirement.
