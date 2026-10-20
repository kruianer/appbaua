---
id: bug-036
app: appbaua
req: req-048
priority: high
created: 2026-10-18
---

# Observed

bug-034 ist behoben und auf dev deployt, das Feld unter
"Claude schreibt … (seit 0:42)" ist aber **weiterhin etwa eine halbe
Zeile hoch**. Der Text darin ist vorhanden und nicht lesbar.

Das Mitrollen aus bug-034 funktioniert; nur die Höhe stimmt nicht.

# Expected

Das Feld mit den Schritten ist mindestens so hoch wie einige Zeilen
Text und zeigt die letzten Schritte lesbar. Es wird nicht
zusammengedrückt, wenn der Platz knapp wird — eher wird das Gespräch
darüber gerollt.

# Steps

1. Eine Nachricht abschicken, die Claude länger beschäftigt.
2. Unter "Claude schreibt … (seit …)" erscheint ein schmaler Streifen
   mit nicht lesbarem Inhalt.

# Hinweis zur Ursache

bug-034 hat `minHeight: 0` am Gesprächsbereich gesetzt (Zeile 288) —
richtig, aber am falschen Element für dieses Problem.

Der Block steht in einem **Fragment** (`<>`, Zeile 345). Seine Kinder
sind damit direkte Flex-Kinder des Gesprächsbereichs, der
`flexDirection: "column"` hat. Das Schritte-Feld (Zeile 357 ff.) trägt
`maxHeight: 160` und `overflowY: "auto"`, aber **kein
`flexShrink: 0`** — Flexbox darf es also beliebig zusammenschrumpfen,
sobald die Summe der Kinder den Platz übersteigt. Genau das passiert,
sobald das Gespräch ein paar Nachrichten lang ist.

`maxHeight` begrenzt nach oben, nicht nach unten. Ohne `flexShrink: 0`
(oder ein `minHeight`, das eine Untergrenze setzt) hat das Feld keine
garantierte Höhe.

Richtung für den Fix — bitte selbst abwägen:

**Was schrumpfen darf und was nicht.** Das Schritte-Feld und das
Lebenszeichen sollten ihre Höhe behalten; nachgeben soll die Liste der
Nachrichten darüber, die ohnehin rollt. Heute ist es umgekehrt.

**Eine Untergrenze statt nur einer Obergrenze.** Neben `maxHeight: 160`
gehört eine Mindesthöhe, die mehrere Zeilen trägt — sonst ist auch ein
Feld ohne Schrumpfen zu klein, wenn wenig Inhalt da ist.

Zu bedenken: Auf dem iPhone ist der Platz knapp. 160px für die Schritte
plus Eingabefeld plus Lebenszeichen lassen wenig für das Gespräch
übrig. Welche Höhe dort angemessen ist, gehört ausprobiert — req-048
verlangt ausdrücklich, dass die Schritte die Antworten nicht aus dem
Bild drängen.

# Out of Scope

- Das Mitrollen (bug-034, erledigt).
- Breite und Rollbalkenfarbe (bug-033).
- Dass der Chat keine Shell hat (bug-035).
