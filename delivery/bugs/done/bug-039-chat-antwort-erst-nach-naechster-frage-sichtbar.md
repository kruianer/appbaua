---
id: bug-039
app: appbaua
req: req-040
priority: high
created: 2026-10-21
---

# Observed

Im Chat sehe ich Claudes Antwort oft nicht, wenn sie fertig ist. Sie
erscheint erst, wenn ich die nächste Nachricht abschicke. Ich weiß dann
nicht, ob Claude noch arbeitet oder schon geantwortet hat, und frage
nach ("Was ist los", "Machst noch was", "Ich sehe keine Antwort").
Claude wiederholt daraufhin seine Antwort, die ich eigentlich schon
hätte sehen sollen.

Beispiel aus einem Gespräch am 2026-10-21 im Repo appbaua: Claude hat
drei Rückfragen gestellt. Ich habe sie erst gesehen, nachdem ich
"Machst noch was" geschickt hatte. Bei der nächsten Runde dasselbe
("Ich sehe keine Antwort").

# Expected

Ich sehe fortlaufend alles, was Claude tut: Die Schritte erscheinen,
während er arbeitet (req-048/req-049). Die fertige Antwort steht sofort
im Gespräch, sobald sie fertig ist, ohne dass ich eine weitere
Nachricht schicken oder neu laden muss.

# Steps (optional)

1. Im Chat eines Repos eine Frage stellen, die Claude ein paar
   Werkzeug-Schritte kostet (z. B. Dateien lesen).
2. Warten, bis Claude fertig sein müsste.
3. Es erscheint keine Antwort. Erst nach dem Abschicken einer weiteren
   Nachricht steht die vorige Antwort da.
