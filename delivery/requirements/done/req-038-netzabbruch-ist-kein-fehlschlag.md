---
id: req-038
title: Ein Netzabbruch verwirft das Paket nicht
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-09-07
---

# Goal (Why)

Reißt die Verbindung während der Arbeit ab, wandert das Paket nach
`failed/` — als wäre etwas an ihm falsch. Am 07.09. traf es bug-021 in
Wegfara: 16 Minuten gearbeitet, dann `API Error: Connection closed
mid-response`. Das Paket war in Ordnung, die Leitung nicht. Ich will,
dass solche Läufe erneut versucht werden, statt Pakete auszusortieren,
an denen nichts fehlt.

# Function (What)

Ein Abbruch, der von der Verbindung kommt, gilt nicht als Fehlschlag des
Pakets. Der Worker behandelt ihn wie ein Rate-Limit (req-029) oder eine
abgelaufene Anmeldung (bug-019):

- Die `.md` bleibt in `ready/` und wandert NICHT nach `failed/`.
- Der Worker pausiert kurz und nimmt die Arbeit dann wieder auf.
- Im Verlauf steht ein Eintrag mit dem Grund, der als solcher erkennbar
  ist — kein gewöhnlicher Fehler-Eintrag.

Als Verbindungsabbruch zählen Abbrüche zum KI-Anbieter ebenso wie zu
GitHub: eine mitten in der Antwort abgerissene Verbindung, ein
fehlgeschlagener Verbindungsaufbau, eine nicht auflösbare Adresse.

Die Pause ist kurz — Minuten, nicht Stunden. Anders als bei einem
Rate-Limit oder einer abgelaufenen Anmeldung endet eine Netzstörung von
selbst und ohne festen Zeitpunkt.

Häufen sich solche Abbrüche für dasselbe Paket, gibt der Worker
irgendwann auf und legt es doch nach `failed/` — mit dem Vermerk, wie oft
es versucht wurde. Sonst könnte ein Paket, das aus einem anderen Grund
immer wieder abbricht, den Worker dauerhaft beschäftigen.

# Acceptance Criteria

- [ ] Given ein Claude-Lauf endet mit "Connection closed mid-response",
  when der Worker das verarbeitet, then bleibt die `.md` in `ready/` und
  wandert NICHT nach `failed/`.
- [ ] Given derselbe Fall, when ich den Verlauf ansehe, then steht dort
  ein Eintrag, der den Netzabbruch als Grund nennt, und KEIN gewöhnlicher
  Fehler-Eintrag.
- [ ] Given ein Netzabbruch ist aufgetreten, when die Pause vorbei ist,
  then nimmt der Worker dasselbe Paket erneut auf.
- [ ] Given ein Paket ist dreimal hintereinander an einem Netzabbruch
  gescheitert, when es ein viertes Mal abbricht, then wandert es nach
  `failed/` und der Verlauf nennt die Anzahl der Versuche.
- [ ] Given ein Lauf scheitert an einer roten Testsuite, when der Worker
  das verarbeitet, then wandert das Paket wie bisher nach `failed/` —
  die neue Behandlung greift NUR bei Verbindungsabbrüchen.
- [ ] Given ein Paket wurde wegen eines Netzabbruchs zurückgestellt und
  beim nächsten Versuch erfolgreich abgearbeitet, when ich es ansehe,
  then liegt es in `done/` und der Zähler der Versuche ist zurückgesetzt.
- [ ] Given ein Netzabbruch, when der Worker pausiert, then dauert die
  Pause Minuten und nicht Stunden.

# Constraints

- Es gibt bereits zwei Ausgänge dieser Art: `rate-limited` und
  `auth-expired` (`lib/execute-step.ts`, Zeilen ~149 und ~156). Der neue
  Fall gehört daneben, nicht als eigener Mechanismus.
- Für GitHub-Aufrufe existiert seit bug-020 bereits eine Erkennung
  vorübergehender Netzwerkfehler (`isTransientNetworkError`). Sie deckt
  den Abbruch zum KI-Anbieter nicht ab — beide Fälle sollen dieselbe
  Behandlung bekommen.
- Die Zählung der Fehlversuche je Paket muss einen Neustart des Workers
  überstehen, sonst zählt sie nach jedem Neustart von vorn.
- Ein Netzabbruch darf nicht mit einem Timeout des Claude-Laufs
  verwechselt werden: Ein Lauf, der die Zeitgrenze reißt, ist ein anderer
  Fall und bleibt wie bisher ein Fehlschlag.

# Out of Scope

- Beheben der Netzstörung selbst.
- Retten der bereits geleisteten Arbeit bei einem Abbruch — das ist
  req-036.
- Benachrichtigung bei gehäuften Netzabbrüchen.
- Anpassen der Pausendauer über die Oberfläche.
- Änderungen an der Behandlung von Rate-Limits oder abgelaufener
  Anmeldung.
