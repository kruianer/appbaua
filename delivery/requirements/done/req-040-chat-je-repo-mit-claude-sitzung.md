---
id: req-040
title: Chat mit einer Claude-Sitzung je Repo
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-17
---

# Goal (Why)

Ich schreibe meine Requirements heute in VS Code am Rechner. Ich will
das in appbaua tun — von überall, auch vom Handy, und an mehreren Repos
gleichzeitig, ohne den Faden zu verlieren.

# Function (What)

Der Menüpunkt "Chat" zeigt oben eine Auswahl des Repos, um das es
gerade geht, und darunter ein Gespräch mit Claude.

Jedes Repo hat sein eigenes Gespräch und seine eigene Claude-Sitzung.
Schalte ich das Repo um, sehe ich dessen Gespräch — eine Antwort, die im
vorigen Repo noch läuft, läuft dort weiter und steht beim Zurückschalten
da. Gespräche bleiben erhalten, wenn ich die App schließe.

Claude arbeitet im gewählten Repo wie in einer Sitzung am Rechner: es
liest und ändert Code, führt Befehle und Tests aus, committet und pusht.
Ich nutze das vor allem, um Requirements und Bugs zu erfassen, aber auch
um etwas nachzusehen oder gezielt zu testen.

Der nächtliche Worker läuft davon unabhängig weiter — er wartet nie auf
den Chat, und der Chat wartet nie auf ihn.

# Acceptance Criteria

- [x] Given ich öffne den Chat zum ersten Mal, when die Ansicht
      erscheint, then sehe ich eine Repo-Auswahl und ein leeres
      Eingabefeld.
- [x] Given ich öffne die Repo-Auswahl, when ich die Einträge lese, then
      stehen dort alle eingetragenen Repos, auch die inaktiven.
- [x] Given ich habe zuletzt mit "CellarVoice" gearbeitet, when ich den
      Chat erneut öffne, then ist "CellarVoice" vorausgewählt.
- [x] Given ich schreibe "Welche Bugs liegen in ready?" im Repo
      "CellarVoice", when Claude antwortet, then steht die Antwort im
      Gespräch.
- [x] Given in "CellarVoice" läuft gerade eine Antwort, when ich auf
      "Wellarita" umschalte, then kann ich dort sofort schreiben.
- [x] Given ich habe in "CellarVoice" eine Antwort abgewartet, when ich
      nach "Wellarita" und zurück schalte, then steht das CellarVoice-
      Gespräch unverändert da.
- [x] Given ich habe die App geschlossen und öffne sie neu, when ich den
      Chat eines Repos öffne, then ist das bisherige Gespräch noch da.
- [x] Given ich sehe "CellarVoice" an und in "Wellarita" wird eine
      Antwort fertig, when ich die untere Leiste ansehe, then trägt der
      Chat-Knopf einen Hinweispunkt.
- [x] Given der Hinweispunkt ist zu sehen, when ich das Repo mit der
      fertigen Antwort öffne, then ist der Punkt verschwunden.
- [x] Given in fünf Repos laufen Sitzungen, when ich in einem sechsten
      Repo schreibe, then bekomme ich dort eine Antwort.
- [x] Given die Sitzung des am längsten unbenutzten Repos wurde dafür
      beendet, when ich dieses Repo öffne, then ist sein Gespräch
      vollständig lesbar.
- [x] Given ich habe acht Stunden nichts geschrieben, when ich den Chat
      eines Repos öffne, then ist das Gespräch noch da und ich kann
      weiterschreiben.
- [x] Given das Abo-Limit ist erreicht, when ich eine Nachricht
      abschicke, then steht im Gespräch, dass das Limit erreicht ist und
      dass der nächtliche Worker davon ebenfalls betroffen ist.
- [x] Given im Chat läuft eine Sitzung, when der nächtliche Worker einen
      Lauf beginnt, then wird meine Sitzung NICHT beendet oder
      angehalten.
- [x] Given Claude hat im Chat eine Datei geändert, when ich im Repo
      nachsehe, then liegt die Änderung NICHT in der Arbeitskopie des
      Workers.

# Constraints

- Claude läuft über das Abo des Betreibers, nicht über einen
  API-Schlüssel. Chat und nächtlicher Worker teilen dieses Abo: Die
  Prozesse sind unabhängig, aber das Abo hat eine Obergrenze, die beide
  gemeinsam ausschöpfen können. Das lässt sich nicht aufteilen, nur
  anzeigen (siehe Kriterium zum Abo-Limit).
- Der Chat benutzt eine eigene Arbeitskopie je Repo, getrennt von der
  des Workers. Grund: Eine gemeinsame Arbeitskopie würde einen
  laufenden nächtlichen Lauf beschädigen.
- Es laufen höchstens fünf Claude-Sitzungen gleichzeitig. Wird eine
  sechste gebraucht, wird die am längsten unbenutzte beendet; ihr
  Gesprächstext bleibt erhalten.
- Eine Sitzung ohne Eingabe wird nach acht Stunden beendet. Der
  Gesprächstext bleibt erhalten.
- Claude läuft im Chat immer mit dem stärksten Modell (Opus), unabhängig
  davon, welches Modell am Repo für den nächtlichen Worker eingetragen
  ist.
- Claude pusht im Chat ausschließlich nach `dev` — dieselbe Regel, die
  für den nächtlichen Worker gilt. Nach `main` geht es nur über das
  bestehende Human-Gate (delivery/devops.md).
- Wer in appbaua angemeldet ist, kann über den Chat Code in allen
  eingetragenen Repos ändern und nach `dev` pushen. Der Zugang ist
  damit so viel wert wie der Schreibzugriff auf diese Repos.

# Out of Scope

- Der Umbau der unteren Leiste und der eingekreiste Chat-Knopf — das ist
  req-039. Hier wird nur der Hinweispunkt auf diesem Knopf behandelt.
- Eine Benachrichtigung außerhalb der App (z.B. per Telegram), wenn eine
  Antwort fertig wird.
- Ein Gespräch, das mehrere Repos gleichzeitig umfasst.
- Dateien oder Bilder an eine Nachricht anhängen.
- Ein Durchsuchen oder Exportieren alter Gespräche.
- Ein Löschen einzelner Nachrichten aus einem Gespräch.
