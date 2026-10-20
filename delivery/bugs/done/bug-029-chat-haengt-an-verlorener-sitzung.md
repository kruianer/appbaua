---
id: bug-029
app: appbaua
req: req-040
priority: high
created: 2026-10-18
---

# Observed

Im Chat kommt auf jede Nachricht:

```
Fehler: Claude-Lauf fehlgeschlagen:
No conversation found with session ID: 1e5931c7-d5eb-40fd-94e4-4518dd3b757c
```

Das Repo ist damit **dauerhaft blockiert**: Die Sitzungskennung bleibt
gespeichert, also scheitert auch jede weitere Nachricht mit demselben
Fehler. Es gibt keinen Weg, davon wegzukommen — weder durch Neuladen
noch durch Umschalten und Zurückschalten.

# Expected

Kennt Claude die gespeicherte Sitzung nicht mehr, beginnt der Chat eine
neue und antwortet. Das bisherige Gespräch bleibt lesbar; dass der
Faden gerissen ist, darf sichtbar sein — aber es blockiert nicht.

# Steps

1. In einem Repo eine Nachricht schreiben, Antwort abwarten.
2. Den App-Container neu starten (oder deployen).
3. Im selben Repo erneut schreiben → der Fehler erscheint, immer wieder.

# Hinweis zur Ursache

`lib/chat-session-manager.ts` (Zeile 107–113) merkt sich je Repo eine
`claudeSessionId` und ruft Claude mit `resume: sessionId` auf. Es gibt
aber keinen Zweig für den Fall, dass Claude diese Sitzung nicht mehr
kennt — der Fehler wird durchgereicht und die Kennung bleibt stehen.

**Warum die Sitzung verschwindet** (gemessen, nicht vermutet): Der Chat
arbeitet in `/tmp/appbaua-chat/` (`CHAT_WORK_ROOT` in
`lib/chat-workspace.ts`), und Claude legt seine Sitzungen unter
`$HOME/.claude/projects/` ab — benannt nach dem Arbeitsverzeichnis, hier
`-tmp-appbaua-chat-...`.

`/tmp` liegt im Dateisystem des Containers und ist nach jedem Neustart
leer. Die Arbeitskopie ist dann weg, die Sitzung in `.claude/projects/`
zeigt ins Leere — aber die Kennung steht weiter in der Datenbank.

Dasselbe Muster wie bug-024: Was nach `/tmp` geschrieben wird, überlebt
keinen Neustart.

Richtung für den Fix — bitte selbst abwägen:

Zwei Ebenen, und die erste ist die wichtigere:

1. **Den Fehler abfangen.** Meldet Claude "No conversation found",
   verwirft der Chat die gespeicherte Kennung, beginnt eine neue
   Sitzung und beantwortet die Nachricht. Das behebt den Dauerzustand
   und schützt auch gegen andere Gründe, aus denen eine Sitzung
   wegfallen kann.
2. **Das Arbeitsverzeichnis haltbar machen.** `/tmp` ist dafür der
   falsche Ort. Der Worker hat sein `/work` seit req-036 als Volume,
   genau deshalb. Zu entscheiden ist, ob der Chat ein eigenes Volume
   bekommt — dann bleiben Arbeitskopie UND Sitzung erhalten, und der
   Faden reißt beim Deploy nicht mehr.

Nur Punkt 2 ohne Punkt 1 wäre zu wenig: Eine Sitzung kann auch ohne
Neustart verfallen, und dann stünde der Chat wieder.

# Out of Scope

- Die Chat-Oberfläche (sichtbare Schritte, Abbrechen, Modellwahl).
- Die Frage, ob Gespräche nach acht Stunden Leerlauf enden (req-040,
  so gewollt).
