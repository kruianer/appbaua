---
id: bug-037
app: appbaua
req: req-040
priority: high
created: 2026-10-19
---

# Observed

Der Chat verlangt praktisch täglich eine neue Anmeldung:

```
Anmeldung abgelaufen. Im Worker-Container dieser Umgebung neu anmelden:
docker exec -it appbaua-dev-worker-1 claude login

Failed to authenticate.
API Error: 401 OAuth access token has expired. Re-authenticate to continue.
```

Gestern angemeldet, heute wieder dieselbe Meldung. Der nächtliche
Worker läuft derweil ohne Unterbrechung durch — seine Anmeldung bleibt
gültig.

# Expected

Eine Anmeldung hält wochenlang, wie beim Worker. Neu anmelden muss ich
mich nur, wenn der Refresh-Token selbst abläuft (etwa vier Wochen) —
nicht täglich.

# Steps

1. Im dev-Worker `claude login` ausführen.
2. Chat benutzen — er funktioniert.
3. Am nächsten Tag erneut benutzen → "OAuth access token has expired".

# Hinweis zur Ursache

`docker-compose.yml`, Zeile 115:

```yaml
- claude-home:/claude-home:ro
```

**Die Anmeldedatei ist für den Chat nur lesbar** — eine Auflage aus
bug-028, die ich dort selbst gesetzt habe.

Ein OAuth-Zugangstoken ist kurzlebig (Stunden, nicht Wochen). Claude
Code erneuert ihn selbstständig mit dem Refresh-Token und **schreibt
die Datei dabei neu**. Genau das kann der Chat nicht: Er liest einen
abgelaufenen Token, scheitert, und beim nächsten Mal wieder.

Der Worker hat das Problem nicht — bei ihm ist dasselbe Volume
schreibbar eingehängt (Zeile 180), er erneuert den Token im
Vorbeigehen.

**Die Begründung in bug-028 war falsch.** Dort steht: „schreiben muss
nur `claude login`, und das läuft im Worker-Container". Schreiben muss
aber auch jede normale Token-Erneuerung — also jeder Lauf. Dasselbe
Missverständnis hatte schon bug-032 verursacht (die Sitzungen liegen
ebenfalls unter `$HOME/.claude/`); dort wurde es mit einem zweiten
Volume über dem Unterpfad gelöst, ohne die `:ro`-Auflage anzutasten.
Für die Anmeldedatei geht dieser Weg nicht: Sie ist die Datei, um die
es bei `:ro` gerade geht.

Richtung für den Fix — bitte selbst abwägen:

Das `:ro` muss für `.credentials.json` fallen, sonst ist der Chat
dauerhaft unbrauchbar. Damit entfällt die Auflage aus bug-028 in ihrem
Kern. Das gehört **dort vermerkt**, nicht stillschweigend rückgängig
gemacht — und es gehört begründet, nicht nur gemacht.

Was die Auflage schützen sollte: dass ein Fehler im Chat die Anmeldung
beschädigt und damit auch den nächtlichen Worker lahmlegt, der
dieselbe Datei benutzt. Dieses Risiko bleibt bestehen. Zu prüfen wäre,
ob dev und prod getrennte Anmeldungen bekommen sollten — dann träfe
ein beschädigter Chat auf dev den prod-Worker nicht. Heute sind die
Volumes bereits getrennt (`appbaua-dev_claude-home` und
`appbaua-prod_claude-home`), die Trennung besteht also schon; sie ist
nur nirgends als Schutz festgehalten.

Zu bedenken: Nach dem Fix muss die Anmeldung einmal neu gemacht werden,
weil der gespeicherte Token bereits tot ist.

# Out of Scope

- Die Meldung selbst. Sie ist seit bug-031 gut: Sie nennt Ursache,
  Container und Befehl mit Kopierknopf. Hier geht es darum, dass sie
  gar nicht mehr erscheinen soll.
- Eine Warnung, bevor der Refresh-Token nach Wochen abläuft.
