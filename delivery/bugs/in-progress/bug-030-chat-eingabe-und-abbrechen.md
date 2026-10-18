---
id: bug-030
app: appbaua
req: req-040
priority: normal
created: 2026-10-18
---

# Observed

Das Eingabefeld des Chats ist für einen Satz gebaut, nicht für das,
was man Claude tatsächlich schreibt:

1. **Es wächst nicht mit.** Es ist fest eine Zeile hoch
   (`rows={1}`). Schreibe ich mehr, sehe ich nur noch die letzte
   Zeile — der Anfang ist weg, obwohl darunter Platz wäre.
2. **Absenden nur mit der Maus.** Enter macht einen Zeilenumbruch;
   zum Abschicken muss ich zum Knopf greifen.
3. **Ein laufendes Gespräch lässt sich nicht stoppen.** Habe ich
   versehentlich etwas Falsches losgeschickt oder merke, dass Claude
   in die falsche Richtung arbeitet, bleibt nur Warten — bis zu
   zwei Stunden (`CLAUDE_TIMEOUT_MINUTES`). Das Repo ist so lange
   blockiert.

# Expected

1. Das Feld wächst mit dem Text in die Höhe, bis zu einer Grenze —
   danach rollt sein Inhalt. Kein Rollbalken, solange es noch wachsen
   kann.
2. **Enter schickt ab.** Eine neue Zeile macht Umschalt+Enter.
3. Während eine Antwort läuft, steht an der Stelle des Senden-Knopfes
   ein Knopf zum Stoppen. Ein Druck darauf beendet den Lauf; das
   bisher Gesagte bleibt im Gespräch stehen, und ich kann sofort
   weiterschreiben.

# Steps

1. Chat öffnen, mehrere Zeilen Text eintippen → nur die letzte ist zu
   sehen.
2. Enter drücken → es entsteht ein Umbruch, nichts wird abgeschickt.
3. Eine Nachricht abschicken → es gibt keinen Weg, sie abzubrechen.

# Hinweis zur Ursache

In `components/Chat.tsx` (ab Zeile 209):

- Das `<textarea>` steht auf `rows={1}` mit `resize: "none"` und ohne
  Höhenanpassung.
- Es gibt keinen `onKeyDown`-Handler.
- Der Senden-Knopf wird bei laufender Antwort nur zu „…" und
  deaktiviert (`disabled={… || sending}`).

**Für das Stoppen fehlt die Grundlage, nicht nur der Knopf.**
`lib/chat-session-manager.ts` führt laufende Läufe in `runningTurns`
(Zeile 147) — aber nur als Promise. Es gibt keinen Weg zum Prozess
und damit keinen Abbruch. Das ist der aufwendigste der drei Punkte:
Es braucht einen Griff auf den laufenden Lauf (der Worker hat dafür
seit bug-023 eine eigene Prozessgruppe) und einen Aufruf, über den
die Oberfläche ihn auslöst.

Richtung für den Fix — bitte selbst abwägen:

**Die Höhengrenze.** Unbegrenztes Wachsen schiebt das Gespräch nach
oben aus dem Bild. Etwa die halbe Höhe des Gesprächsbereichs erscheint
sinnvoll — die genaue Grenze gehört ausprobiert, nicht gerechnet.

**Auf dem Telefon.** Dort ist Enter die Absende-Taste der Tastatur;
Umschalt+Enter gibt es praktisch nicht. Ob die Enter-Regel auf
schmalen Bildschirmen anders ausfallen muss, gehört entschieden — das
Feld muss dort in jedem Fall mit offener Tastatur bedienbar bleiben
(req-041).

**Was beim Stoppen mit dem Angefangenen geschieht.** Erwartet ist:
stehen lassen, als Teil des Gesprächs. Ein stiller Abbruch, der alles
verwirft, wäre schlechter — man sieht dann nicht, wie weit Claude kam.

# Out of Scope

- Die laufenden Schritte sichtbar machen (was Claude gerade tut).
  Eigenes Thema; hier geht es nur um das Anhalten.
- Modellwahl im Chat.
- Dateien oder Bilder an eine Nachricht anhängen.
