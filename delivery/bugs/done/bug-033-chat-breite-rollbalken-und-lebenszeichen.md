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
5. **Die Schritte erscheinen erst im Nachhinein.** Während des Laufs
   ist nichts zu sehen; erst wenn die Antwort da ist, lassen sie sich
   unter "Schritte" aufklappen. Genau dann braucht man sie nicht mehr.

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

**Zu 4 und 5 — das Wesentliche:** Die Schritte werden erfasst (am Ende
sind sie ja da), sie kommen nur während des Laufs nicht bei der
Oberfläche an.

Der Weg: `lib/chat-session-manager.ts` legt den Tail in
`const currentSteps = new Map<string, string>()` (Zeile 97) ab,
`getChatSteps` liest daraus, und
`app/api/chat/[repoId]/steps/route.ts` gibt ihn zurück. Die Oberfläche
fragt alle 1,5 Sekunden nach (Zeile 100 ff.) und zeigt das Ergebnis
während des Laufs an (Zeile 272 ff.).

**Der Verdacht gilt der Map im Arbeitsspeicher.** Sie lebt in der
Node-Instanz, die den Lauf gestartet hat. Ob eine parallel
hereinkommende GET-Anfrage dieselbe Instanz und denselben Stand sieht,
ist nicht garantiert — und der Lauf hält seinen Aufruf die ganze Zeit
in einem `await` fest. Dass am Ende alles da ist, passt dazu: Erst
nach dem Lauf fragt die Oberfläche in einem Zustand ab, in dem sie den
fertigen Stand bekommt.

Bitte an der laufenden dev-Umgebung messen, nicht aus dem Code
schließen: Liefert `/api/chat/<repo>/steps` WÄHREND eines Laufs etwas?
Davon hängt ab, ob es an der Map liegt oder an etwas anderem.

Zu bedenken, falls es die Map ist: Der Verlauf des Workers löst
dasselbe Problem über die Datenbank (req-008 schreibt den Tail dorthin).
Das wäre der erprobte Weg.

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
