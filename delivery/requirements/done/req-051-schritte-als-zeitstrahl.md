---
id: req-051
title: Schritte als Zeitstrahl wie in Claude Code
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-21
changes: req-049
---

# Goal (Why)

Ich will auf einen Blick sehen, was Claude im Chat gerade tut, was
geklappt hat und wo es hakt, so wie in der Oberfläche von Claude Code.
Heute stehen die Schritte als Textzeilen untereinander, ohne Ergebnis
und ohne Status.

# Function (What)

Die Schritte einer Antwort hängen an einer senkrechten Linie, ein Punkt
je Schritt. Daneben steht die Art des Schritts in Fett (z. B. "Bash",
"Read", "Edit") und dahinter das Ziel: der Befehl oder die Datei.

Der Punkt zeigt den Status: grau = läuft, grün = geklappt, rot =
fehlgeschlagen.

Das Ergebnis eines Schritts (die Ausgabe eines Befehls, der Inhalt
einer Änderung) ist eingeklappt und klappt per Tipp auf den Schritt
auf. Ein aufgeklapptes Ergebnis zeigt höchstens die ersten 20 Zeilen,
darunter "alle anzeigen" für den Rest.

Alles andere aus req-049 bleibt: Die Schritte stehen zwischen Frage und
Antwort, haben keinen eigenen Rollbalken, bleiben nach der Antwort
stehen und treten hinter sie zurück. Sie werden mit dem Gespräch
gespeichert, die Ergebnisse auch. Vorbild für das Aussehen ist die
Oberfläche von Claude Code. Es gibt keine eigene Vorlage.

Dies ersetzt die Zeilen-Darstellung aus req-049. Es entsteht keine
zweite Anzeige daneben.

# Acceptance Criteria

- [x] Given Claude führt "npm test" aus, when der Schritt erscheint,
      then steht er als Punkt auf einer senkrechten Linie mit "Bash"
      in Fett und dahinter "npm test".
- [x] Given der Befehl "npm test" läuft noch, when ich den Punkt
      ansehe, then ist er grau.
- [x] Given "npm test" ist erfolgreich durchgelaufen, when ich den
      Punkt ansehe, then ist er grün.
- [x] Given "npm test" ist mit Fehlern beendet, when ich den Punkt
      ansehe, then ist er rot.
- [x] Given ein abgeschlossener Schritt, when ich ihn ansehe, then ist
      sein Ergebnis eingeklappt.
- [x] Given ich tippe auf den Schritt "npm test", when er aufklappt,
      then sehe ich die Ausgabe des Befehls.
- [x] Given die Ausgabe hat 300 Zeilen, when ich den Schritt aufklappe,
      then sehe ich die ersten 20 Zeilen und darunter "alle anzeigen".
- [x] Given ich habe die App geschlossen und öffne das Gespräch neu,
      when ich einen Schritt einer früheren Antwort antippe, then klappt
      sein Ergebnis auf.
- [x] Given Claude hat geantwortet, when ich das Gespräch ansehe, then
      ist der Zeitstrahl NICHT verschwunden und es steht KEINE zweite
      Schritt-Anzeige daneben.

# Constraints

- Für Ergebnisse und Status muss der Ereignisstrom mehr liefern als
  heute (50 Zeilen Rückschau, gekürzte Zeilen, siehe req-049). Reicht
  die Quelle nicht, wird sie mit geändert. Die Anzeige soll sich nicht
  an eine zu knappe Quelle anpassen.

# Out of Scope

- Uhrzeit oder Dauer je Schritt
- Claudes Gedankengänge
- Befehle freigeben oder ablehnen
- Der Zeitstrahl im Verlauf des Workers, dort bleibt es, wie es ist
