---
id: req-042
title: Container-Übersicht mit Speicher und CPU
app: appbaua
area: App-Überwachung
priority: normal
created: 2026-10-17
---

# Goal (Why)

Auf dem Rechner laufen über fünfzig Container für neun Apps, und der
Arbeitsspeicher ist knapp. Wenn er voll läuft, will ich auf einen Blick
sehen, welche App ihn verbraucht — heute muss ich mich dafür per
Kommandozeile auf den Server verbinden.

# Function (What)

Der Menüpunkt "Zustand" bekommt eine zweite Ansicht: eine Liste aller
Container, die auf dem Rechner laufen.

Die Container sind nach App gruppiert, dev und prod getrennt
("appbaua · dev", "appbaua · prod"). Container, die zu keiner
eingetragenen App gehören, stehen am Ende unter "Sonstige" — sie
verbrauchen denselben Speicher.

Zu jedem Container steht: sein Name, sein Zustand (läuft, beendet,
startet neu), wie lange er in diesem Zustand ist, wie viel
Arbeitsspeicher er belegt und wie hoch seine CPU-Last ist.

Jede Gruppe zeigt die Summe ihres Speicherverbrauchs, damit die Frage
"welche App frisst den Speicher" ohne Kopfrechnen beantwortet ist.

Zu jedem Container gibt es denselben Neustart-Knopf wie bei den
Prüfungen.

# Acceptance Criteria

- [x] Given ich öffne den Menüpunkt "Zustand", when die Ansicht
      erscheint, then kann ich zur Container-Übersicht wechseln.
- [ ] Given ich öffne die Container-Übersicht, when sie geladen ist,
      then sehe ich eine Gruppe "appbaua · prod".
- [ ] Given ich öffne die Container-Übersicht, when ich die Gruppe
      "appbaua · prod" ansehe, then stehen dort unter anderem die
      Container "appbaua-prod-app-1" und "appbaua-prod-worker-1".
- [ ] Given ich öffne die Container-Übersicht, when ich einen laufenden
      Container ansehe, then steht dort sein belegter Arbeitsspeicher
      als Zahl mit Einheit (z.B. "412 MB").
- [ ] Given ich öffne die Container-Übersicht, when ich einen laufenden
      Container ansehe, then steht dort seine CPU-Last in Prozent.
- [ ] Given ich öffne die Container-Übersicht, when ich einen laufenden
      Container ansehe, then steht dort sein Zustand und seit wann
      (z.B. "läuft · seit 3 Stunden").
- [ ] Given eine Gruppe enthält mehrere Container, when ich ihre
      Überschrift ansehe, then steht dort die Summe des Speichers aller
      Container dieser Gruppe.
- [ ] Given auf dem Rechner läuft ein Container, der zu keiner
      eingetragenen App gehört, when ich die Übersicht ansehe, then
      steht er in der Gruppe "Sonstige".
- [ ] Given ein Container ist beendet, when ich ihn in der Übersicht
      ansehe, then ist sein Zustand als beendet erkennbar und es steht
      KEINE CPU-Last bei ihm.
- [ ] Given ich sehe einen Container in der Übersicht, when ich seinen
      Neustart-Knopf drücke, then wird dieser Container neu gestartet.
- [ ] Given ich öffne die Container-Übersicht auf einem iPhone, when ich
      sie ansehe, then sind Name, Zustand, Speicher und CPU jedes
      Containers lesbar, ohne seitlich schieben zu müssen.
- [ ] Given die Messung läuft noch, when ich die Übersicht öffne, then
      sehe ich, dass gemessen wird, und die Seite wirkt nicht leer.

# Constraints

- Die CPU-Last eines Containers lässt sich nur aus ZWEI Messungen im
  Abstand errechnen, nicht aus einer Momentaufnahme. Bei über fünfzig
  Containern dauert ein Durchlauf daher spürbar; die Anzeige zeigt
  Werte, die ein paar Sekunden alt sind. Eine Anzeige in Echtzeit ist
  nicht möglich.
- Der Zugriff auf die Docker-Engine läuft ausschließlich über den
  health-agent, nie aus dem App-Container heraus. Der Agent kennt
  heute fünf feste Aufrufe und reicht keinen beliebigen Pfad an die
  Engine durch; ein neuer Aufruf für die Messwerte folgt demselben
  Muster. Grund: bug-005 — wer mit der Docker-Engine reden darf, ist
  auf dem Rechner praktisch root, und der App-Container ist der
  einzige, der aus dem Internet erreichbar ist.

# Out of Scope

- Ein Verlauf der Messwerte über die Zeit (Kurven, Verlaufsgrafik).
  Diese Ansicht zeigt den Zustand jetzt.
- Eine Meldung oder Warnung, wenn ein Container zu viel Speicher
  belegt.
- Das Setzen von Speichergrenzen für Container — das ist bug-026.
- Das Starten oder Anhalten von Containern. Nur Neustart, wie bisher.
- Netzwerk- und Festplattenverbrauch je Container.
- Werte des Rechners insgesamt (freier Speicher, Gesamtlast) — die
  stehen bereits als System-Kacheln in "Aktivität" (req-009).
