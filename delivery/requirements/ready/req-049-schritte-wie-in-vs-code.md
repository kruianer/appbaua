---
id: req-049
title: Die Schritte so lesen wie in VS Code
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-19
changes: req-048
---

# Goal (Why)

Ich will beim Zusehen verstehen, was Claude tut — welche Datei es
liest, welchen Befehl es ausführt, was dabei herauskommt. In VS Code
sehe ich das; im Chat bekomme ich ein schmales Kästchen mit einem
Rollbalken, in dem nichts zu erfassen ist, und am Ende verschwindet es
ganz.

# Function (What)

Die Schritte stehen im Gesprächsverlauf wie die Nachrichten selbst:
untereinander, in lesbarer Schrift, so hoch wie ihr Inhalt. Kein
Kästchen mit eigenem Rollbalken — der Verlauf rollt, nicht jeder
einzelne Block.

Jeder Schritt ist als solcher erkennbar: was getan wurde und worauf.
Ein gelesener Pfad, ein ausgeführter Befehl, eine geänderte Datei.

Ist die Antwort da, bleiben die Schritte an ihrem Platz stehen. Sie
treten hinter die Antwort zurück, verschwinden aber nicht — ich will
hinterher nachsehen können, wie Claude zu seinem Ergebnis kam.

Dies ersetzt die Anzeige aus req-048 (schmaler Kasten während des
Laufs, danach eingeklappt unter "Schritte"). Es entsteht keine zweite
Anzeige daneben.

# Acceptance Criteria

- [ ] Given Claude arbeitet, when ich die Schritte ansehe, then kann
      ich sie in der normalen Schriftgröße des Gesprächs lesen.
- [ ] Given Claude arbeitet, when ich die Schritte ansehe, then haben
      sie KEINEN eigenen Rollbalken.
- [ ] Given mehrere Schritte sind aufgelaufen, when ich sie ansehe,
      then stehen sie untereinander und ich sehe die letzten ohne zu
      rollen.
- [ ] Given Claude liest eine Datei, when der Schritt erscheint, then
      erkenne ich daran, welche Datei gelesen wurde.
- [ ] Given Claude führt einen Befehl aus, when der Schritt erscheint,
      then erkenne ich den Befehl.
- [ ] Given die Antwort ist eingetroffen, when ich das Gespräch
      ansehe, then stehen die Schritte weiterhin da und sind NICHT
      verschwunden.
- [ ] Given die Antwort ist eingetroffen, when ich das Gespräch
      ansehe, then ist die Antwort deutlicher hervorgehoben als die
      Schritte davor.
- [ ] Given ich rolle im Gespräch nach oben zu einer früheren Frage,
      when ich hinsehe, then finde ich auch deren Schritte.
- [ ] Given ich lese das Gespräch auf dem iPhone, when Schritte und
      Antworten untereinander stehen, then drängen die Schritte die
      Antworten nicht aus dem Bild.

# Constraints

- Der Ereignisstrom liefert heute 50 Zeilen Rückschau
  (`LIVE_TAIL_LINES`), jede auf eine Länge gekürzt
  (`toActivityLine`). Reicht das für eine Darstellung wie in VS Code
  nicht, gehört das mit geändert — die Anzeige soll sich nicht an eine
  zu knappe Quelle anpassen müssen.
- Die Schritte gehören zur jeweiligen Frage. Sie stehen zwischen
  meiner Nachricht und der Antwort darauf, nicht am Ende des
  Gesprächs.

# Out of Scope

- Claudes Gedankengänge. Gemeint sind die sichtbaren Schritte, nicht
  das Nachdenken dazwischen.
- Ein Eingreifen in einen laufenden Schritt (Befehle freigeben oder
  ablehnen).
- Farbliche Hervorhebung einzelner Schritt-Arten oder Symbole je Art.
  Erst muss es lesbar sein.
- Die Darstellung im Verlauf des Workers. Dort bleibt es, wie es ist.
