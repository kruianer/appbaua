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

# Hinweis zur Ursache (Verdacht, bitte reproduce-first verifizieren)

Die Erkennung sitzt in `lib/rate-limit.ts` (`isRateLimit`) und wird in
`lib/execute-step.ts` auf `outcome.summary` des Claude-Laufs angewendet.
Zwei plausible Lücken:

1. **Der Text passt nicht auf die Muster.** `isRateLimit` prüft u.a. auf
   `rate limit`, `usage limit`, `429`, `quota exceeded`, `overloaded`.
   Formuliert die CLI die Meldung anders (oder steckt das Limit im
   stderr-/Event-Stream statt in `summary`), greift die Erkennung nicht.
2. **Der Limit-Fall erreicht die Prüfung gar nicht.** Läuft der Prozess
   z.B. in den 60-Minuten-Timeout (`code === 124`), wird vorher
   `"Claude-Lauf: Timeout (60 min)"` zurückgegeben — der Timeout-Zweig
   greift VOR der Rate-Limit-Prüfung, und ein Lauf, der wegen Drosselung
   hängt, sieht genau so aus.

Der Fix sollte mit einem Test beginnen, der die tatsächliche
Fehlermeldung aus dem Verlauf reproduziert.
