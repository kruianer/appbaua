---
id: bug-011
app: appbaua
req: req-029
priority: high
created: 2026-07-27
---

# Observed

Der Worker lief bei livinggardenkeeper in ein Rate-Limit und hat das
Requirement trotzdem nach `failed/` verschoben und den Lauf beendet — die
mit req-029 eingebaute Rate-Limit-Pause hat nicht gegriffen. Im Verlauf
stand als Fehlermeldung ein Rate-/Usage-Limit.

Betroffene Läufe (livinggardenkeeper, beide am 26.07. spätabends UTC):
- `db09963 worker: req-001-wechselplatte.md fehlgeschlagen` (22:11 UTC)
- `89074c4 worker: req-002-readme-projektuebersicht.md fehlgeschlagen` (22:16 UTC)

req-029 war zu diesem Zeitpunkt bereits auf prod (Promotion `a829009`
gegen 21:45 UTC), der Worker lief also schon mit dem Code, der das
abfangen sollte.

# Expected

Erkennt der Worker ein Rate-/Usage-Limit, gilt das NICHT als Fehlschlag
(req-029): die .md bleibt in `ready/`, es wird nicht nach `failed/`
verschoben, der Worker pausiert bis zum Reset-Zeitpunkt (bzw. ~1 Stunde,
wenn die Meldung keinen nennt) und nimmt die Arbeit danach automatisch
wieder auf. Im Verlauf steht ein Leerlauf-Eintrag mit dem Rate-Limit als
Grund, kein Fehler-Eintrag.

# Steps

1. Worker so lange laufen lassen, bis das Anthropic-Rate-Limit greift.
2. Verlauf ansehen: der Lauf ist als Fehler protokolliert und die .md
   liegt in `failed/` statt in `ready/`.

# Ursache (aus dem Verlauf belegt)

Der exakte Wortlaut aus dem prod-Verlauf (mehrfach, 26.07. 22:01–22:16
UTC, über mehrere Repos hinweg):

```
Claude-Lauf: Claude-Lauf fehlgeschlagen: You've hit your session limit ·
resets 10:50pm (UTC) — req-001-wechselplatte.md nach failed/ verschoben
```

Damit ist die Lücke eindeutig: `isRateLimit` in `lib/rate-limit.ts` prüft
auf `rate limit`, `usage limit`, `429`, `quota exceeded`/`quota reached`
und `overloaded`. Die CLI schreibt aber **"session limit"** — keines der
Muster passt, also wird der Lauf als gewöhnlicher Fehler behandelt und die
.md nach `failed/` verschoben.

Zwei Dinge gehören zum Fix:

1. **Erkennung erweitern:** "session limit" (und sinnvollerweise weitere
   Varianten wie "limit reached"/"limit exceeded") als Rate-Limit
   erkennen.
2. **Reset-Zeitpunkt parsen:** Die Meldung nennt ihn im Format
   `resets 10:50pm (UTC)` — also 12-Stunden-Uhrzeit mit Zeitzone, nicht
   ISO-8601 und kein Unix-Timestamp. `resetAtFrom` erkennt derzeit nur
   die letzten beiden Formate und würde hier auf die 1-Stunden-Pause
   zurückfallen, obwohl die Meldung den genauen Zeitpunkt liefert.

Ein Repro-Test sollte genau diesen Meldungstext verwenden.
