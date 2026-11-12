---
titel: "Eichstrecke — merken, wenn der Worker schlechter arbeitet, bevor es ein echtes Repo trifft"
datum: 2026-11-12
---

## Problem/Nutzen

Wie gut der Worker arbeitet, hängt an drei Stellschrauben, die sich
laufend ändern — und an keiner davon wird gemessen, was eine Änderung
bewirkt:

- **Die Prompts.** `lib/claude-runner.ts` enthält die Anweisungen, nach
  denen jeder Schritt läuft (`fileTaskPrompt`, `testFixPrompt`,
  `ideaPrompt`, `securityPrompt`, …). Die Datei hat bereits 24 Commits.
  Jeder davon kann das Verhalten in *allen* Repos verschieben: Ein Satz
  zu den Etappen (req-036) oder zum Release-Marker (req-046) dazu, und
  der Worker hakt vielleicht Kriterien ab, die er nicht umgesetzt hat,
  oder er committet häufiger rot. Geprüft wird dabei nur, ob der
  *Prompt-Text* stimmt (`claude-runner.test.ts`), nicht, ob ein Modell
  danach noch richtig arbeitet.
- **Das Modell.** req-028 lässt das Modell je Repo wählen. Auf welcher
  Grundlage, steht nirgends — es gibt keinen Vergleich, wie Haiku,
  Sonnet und Opus mit *diesen* Prompts an *dieser* Art Aufgabe
  abschneiden. Auch ein Versionswechsel beim Anbieter ändert das
  Verhalten unbemerkt.
- **Die Umgebung.** CLI-Version, Werkzeuge im Container, Testgate-Logik.

Heute bemerkt man eine Verschlechterung erst, wenn sie in einem echten
Repo Schaden anrichtet: ein schiefes Requirement, ein Nacharbeits-Bug, ein
abgehakter Kasten ohne Umsetzung. Dann ist nicht mehr zu klären, ob es an
der Aufgabe lag, am Prompt, am Modell oder am Zufall. Für einen Worker,
der öffentlich einsetzbar sein soll, ist „wir merken es an den
Ergebnissen“ zu spät und zu ungenau.

Nutzen:

- **Rock-solid Qualität:** Eine Änderung an Prompt oder Modell wird zum
  ersten Mal gegen eine feste Messlatte geprüft, bevor sie die
  echten Repos erreicht.
- **Nachvollziehbarkeit:** „Seit Commit `x` an den Prompts hakt der
  Worker Kriterien ohne Test ab“ wird zu einer belegten Aussage statt
  einer Vermutung. Die Modellwahl je Repo bekommt eine Begründung.
- **Ansprechende Visualisierung:** Eine Messreihe über die Zeit, ein
  Punkt je Lauf, Knicke an Prompt- oder Modellwechseln markiert.
- **Freiraum für Ausgefallenes:** Der Worker bekommt eine Übungsstrecke,
  auf der er regelmäßig gegen sich selbst antritt.

Abgrenzung zu bestehenden Ideen:
- Die [Nacharbeits-Quote](nacharbeits-quote-je-repo-und-task-art.md)
  misst *nachträglich* an echten Aufgaben, die nie gleich sind. Ursache
  und Zufall lassen sich dort nicht trennen.
- Die [Testumfang-Wache](testumfang-wache-gruen-ohne-schwund.md) prüft, ob
  die Tests eines echten Laufs schrumpfen.
- Der [Selbsttest](worker-koerper-selbsttest-und-rueckfallebene.md)
  prüft, ob die Werkzeuge *vorhanden* sind, nicht, ob gut damit
  gearbeitet wird.

Die Eichstrecke hält die Aufgabe fest und misst nur das Verhalten. Damit
lässt sich eine Änderung als einzige Variable herauslösen.

## Skizze

**1. Ein Übungs-Repo mit bekannten Aufgaben.** Ein kleines,
eigenständiges Sandbox-Repo (nicht in der Repo-Liste der echten Arbeit,
ohne Deploy, ohne Remote-Push) mit einer Handvoll fester Aufgaben, die
die typischen Schritte abbilden:
- ein Requirement mit drei Akzeptanzkriterien,
- ein Bug mit absichtlich rotem Test, der nur durch eine echte Korrektur
  grün wird (Löschen oder `.skip` wäre die Abkürzung),
- eine Aufgabe, die eine fehlende Abhängigkeit braucht.

Zu jeder Aufgabe gibt es eine **verdeckte Prüfung**: Tests und Regeln,
die der Worker nicht sieht und die nach dem Lauf außerhalb seines
Checkouts ausgeführt werden.

**2. Ein Eichlauf je Variante.** Ein Lauf setzt das Übungs-Repo auf
seinen Ausgangsstand zurück und lässt den Worker mit genau den Prompts
und dem Modell laufen, die er in echt benutzt. Dafür wird **kein neuer
Weg** gebaut, sondern derselbe Ablauf mit anderem Ziel-Repo. Danach
bewertet die verdeckte Prüfung das Ergebnis, aufgeschlüsselt in einzelne
Messpunkte:

```
Eichlauf #41 · Sonnet 5 · Prompts @ 3e28b85 · 2026-11-12 04:10
  Kriterien umgesetzt          3/3  ✓
  Abgehakt ohne Umsetzung      0    ✓
  Test gelöscht/übersprungen   nein ✓
  Roter Commit                 1    ✗  (Etappe 2)
  Abhängigkeit im Manifest     ja   ✓
  Dauer / Tokens               6m12 · 184k
```

**3. Wann er läuft.** Diese Weiche bleibt offen und wird vor der
Umsetzung geklärt. Vorschlag: als eigener, schaltbarer Task-Typ mit
Zeitfenster (req-002), höchstens einmal pro Woche. Zusätzlich auf
Knopfdruck, etwa vor dem Wechsel des Modells eines Repos. Weil
Eichläufe Budget kosten, zählen sie sichtbar gegen ein eigenes
Kontingent (vgl. req-044).

**4. Die Messreihe (Visualisierung).** Eine Seite „Eichstrecke“ zeigt
je Messpunkt eine Zeitreihe, einen Punkt je Lauf und eine Farbe je
Modell. Senkrechte Marker zeigen Commits an `lib/claude-runner.ts` und
Modellwechsel. Ein Knick direkt nach einem Marker ist die Aussage, um
die es geht. Daneben steht eine Vergleichstabelle der Modelle auf
denselben Aufgaben, als Grundlage für die Wahl nach req-028.

**5. Ehrlichkeits-Regeln.**
- Ein einzelner Lauf ist eine Stichprobe. Die Anzeige sagt das und
  bewertet erst ab mehreren Läufen je Variante. Sie leitet aus einem
  einzelnen Ausreißer keinen „Rückschritt“ ab.
- Die verdeckten Prüfungen liegen nie im Checkout des Workers. Sonst
  lernt der Worker die Prüfung statt der Aufgabe.

**Bewusst NICHT Teil davon:**
- **Keine automatische Reaktion.** Ein schlechter Eichlauf setzt weder
  Prompts zurück noch wechselt er Modelle oder sperrt Deploys. Er
  erzeugt nur einen sichtbaren Befund. Was daraus folgt, entscheidet der
  Mensch.
- **Kein Bezug zum Human-Gate.** Das Übungs-Repo hat kein `main` mit
  prod-Ziel. Promotion und Freigabe bleiben unberührt.
- **Kein stiller Umbau.** Ob das Übungs-Repo ein eigenes Git-Repo, ein
  Ordner in diesem Repo oder ein temporärer Checkout ist, und wie der
  Ausgangsstand zurückgesetzt wird, ist eine Infrastruktur-Weiche. Sie
  wird hier nur vorgeschlagen und vor der Umsetzung mit dem Nutzer
  geklärt.
