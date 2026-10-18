---
id: bug-034
app: appbaua
req: req-040
priority: high
created: 2026-10-18
---

# Observed

Zwei Dinge beim Abschicken einer Nachricht:

1. **Die Ansicht springt nicht nach unten.** Meine eben abgeschickte
   Frage ist nicht zu sehen — ich muss von Hand nachrollen, um sie und
   die Antwort darunter zu finden.
2. **Das Feld unter "Claude schreibt …" ist zusammengequetscht.** Es
   ist etwa halb so hoch wie eine Textzeile; der Text darin ist
   vorhanden, aber nicht lesbar.

# Expected

1. Schicke ich eine Nachricht ab, rollt das Gespräch ans Ende — meine
   Frage steht sichtbar unten. Dasselbe, wenn die Antwort eintrifft
   und während die Schritte wachsen.
2. Jede Zeile, die angezeigt wird, ist auch lesbar. Nichts wird so
   zusammengedrückt, dass die Schrift nicht mehr hineinpasst.

# Steps

1. Chat öffnen, eine Nachricht abschicken.
2. Die Ansicht bleibt stehen, wo sie war — die eigene Frage ist nicht
   zu sehen.
3. Unter "Claude schreibt …" erscheint ein schmaler Streifen mit
   abgeschnittenem Inhalt.

# Hinweis zur Ursache

**Zu 1:** In `components/Chat.tsx` gibt es kein automatisches Rollen —
weder `scrollTop`, `scrollIntoView` noch Ähnliches. Die einzigen
Treffer auf `scrollHeight` (Zeile 77/79) gehören zum mitwachsenden
Eingabefeld aus bug-030, nicht zum Gesprächsbereich.

**Zu 2:** Der Gesprächsbereich (Zeile 237 ff., `data-chat-messages`)
steht auf `flex: 1` mit `overflowY: "auto"`, aber **ohne
`minHeight: 0`**. In einer Flex-Spalte hat ein Kind implizit
`min-height: auto`; ohne das Zurücksetzen gibt Flexbox den Platz nicht
frei, sondern drückt die Kinder zusammen, sobald der Inhalt wächst. Das
Schritte-Feld (Zeile 309 ff.) hat zwar `maxHeight: 160`, bekommt aber
nicht einmal eine Zeilenhöhe.

Die Stelle direkt darunter macht es richtig: Zeile 394/395 setzt
`flex: 1` **und** `minHeight: 0`.

Richtung für den Fix — bitte selbst abwägen:

**Beim Rollen gehört eine Ausnahme bedacht:** Wer nach oben gerollt
hat, um etwas Älteres zu lesen, will nicht bei jeder neuen Zeile nach
unten gerissen werden. Üblich ist, nur dann automatisch zu rollen,
wenn man ohnehin schon am Ende steht — und das Abschicken einer
eigenen Nachricht immer als "ans Ende" zu behandeln.

Zu bedenken: Die Schritte wachsen alle 1,5 Sekunden. Rollt die Ansicht
bei jedem Zuwachs, ohne die Ausnahme oben, wird Lesen unmöglich.

# Out of Scope

- Breite, Rollbalkenfarbe und das Lebenszeichen (bug-033).
- Was die Schritte inhaltlich zeigen (req-048).
