---
id: bug-033
app: appbaua
req: req-040
priority: high
created: 2026-10-18
---

# Observed

Fünf Dinge an der Chat-Ansicht, das letzte ist das wichtigste:

1. **Der Chat nutzt die Breite nicht.** Auf dem Laptop steht das
   Gespräch in einer schmalen Spalte, obwohl der Bereich daneben leer
   bleibt.
2. **Der Rollbalken ist grau**, nicht in den Farben der App.
3. **Die letzte Nachricht wird vom Eingabefeld verdeckt.** Man muss
   von Hand nachrollen, um sie zu Ende zu lesen.
4. **Kein Lebenszeichen.** Während Claude arbeitet, sehe ich keinen
   Hinweis, dass es noch läuft und nicht abgestürzt ist.
5. **Die Schritte erscheinen nicht fortlaufend**, obwohl req-048 sie
   bringen sollte.

# Expected

1. Das Gespräch nutzt die volle Breite des Bereichs, in dem es steht.
2. Der Rollbalken trägt die Akzentfarbe der App.
3. Zwischen der letzten Nachricht und dem Eingabefeld bleibt Luft —
   die letzte Nachricht ist immer vollständig lesbar.
4. Solange gearbeitet wird, ist durchgehend erkennbar, dass etwas
   geschieht — nicht nur ein stehender Text, sondern etwas, das sich
   sichtbar bewegt oder verändert.
5. Die Schritte erscheinen, während sie entstehen, und wachsen weiter.

# Steps

1. Chat auf dem Laptop öffnen → das Gespräch steht in einer schmalen
   Spalte.
2. Eine Nachricht schicken, die länger dauert → "Claude schreibt …"
   steht still, sonst passiert nichts Sichtbares.
3. Eine lange Antwort abwarten → ihr Ende liegt hinter dem
   Eingabefeld.

# Hinweis zur Ursache

**Zu 1:** `components/Chat.tsx` Zeile 226 setzt im Zweispalten-Layout
`maxWidth: 760` mit `alignSelf: "center"`. Das war als Lesebreite
gedacht (req-041), wirkt hier aber auf den ganzen Gesprächsbereich.
Die Lesebreite gehört an den Text, nicht an den Bereich.

**Zu 3:** Der Gesprächsbereich und das Eingabefeld sind zwei
Geschwister ohne Abstand dazwischen; es gibt keinen Zuschlag am unteren
Ende des Rollbereichs.

**Zu 4 und 5 — das Wesentliche:** Der Code dafür existiert und sieht
richtig aus. `lib/chat-session-manager.ts` reicht `onOutput` an
`runClaude` durch (Zeile 178/189), `components/Chat.tsx` fragt alle
1,5 Sekunden `/api/chat/<repo>/steps` ab (Zeile 100 ff.) und zeigt das
Ergebnis während des Laufs an (Zeile 272 ff.).

Dass trotzdem nichts erscheint, heißt: `steps` bleibt leer. Zu prüfen
ist, wo die Kette reißt — ob `onOutput` nie feuert, ob der Tail nicht
gespeichert wird oder ob die Abfrage nichts zurückgibt. Bitte an der
laufenden dev-Umgebung messen, nicht aus dem Code schließen.

Richtung für den Fix — bitte selbst abwägen:

**Das Lebenszeichen darf nicht von den Schritten abhängen.** Heute
steht die Anzeige unter `{steps && …}` — kommen keine Schritte, sieht
man gar nichts. Ein Zeichen, dass gearbeitet wird, muss auch dann da
sein, wenn der Ereignisstrom schweigt (etwa weil Claude gerade
nachdenkt). Eine verstrichene Zeit ("seit 2:14") ist dafür belastbarer
als ein stehender Text.

**Der Rollbalken** lässt sich über `scrollbar-color` einfärben; in
WebKit braucht es zusätzlich `::-webkit-scrollbar-thumb`. Die Farbe
sollte aus den vorhandenen Tokens kommen, nicht neu gewählt werden.

Zu bedenken: Punkt 1 betrifft nur den Gesprächsbereich. Die Lesebreite
für langen Fließtext aus req-041 bleibt sinnvoll — sie gehört an die
einzelne Nachricht, nicht an den Bereich.

# Out of Scope

- Was die Schritte inhaltlich zeigen (req-048).
- Das Stoppen eines laufenden Laufs (bug-030, erledigt).
- Die Sitzungsmeldung bei jeder Nachricht (bug-032).
