---
id: bug-013
app: appbaua
req: req-023
priority: normal
created: 2026-07-27
---

# Observed

Auf der Anmeldeseite ist der Link "Zugang verloren? Mit Backup-Code
wiederherstellen" blau bzw. lila und damit auf dem dunklen Hintergrund
schlecht lesbar. Der Ersteinrichtungs-Link darüber sieht anders (heller)
aus.

# Expected

Die Links auf den Auth-Seiten sind gut lesbar und einheitlich gestaltet —
hell/weiß auf dem dunklen Hintergrund, alle gleich, unabhängig davon, ob
sie schon einmal besucht wurden.

# Steps

1. https://dev.appbaua.com/login aufrufen (abgemeldet).
2. Die beiden Links unter dem Anmelde-Button vergleichen.

# Hinweis zur Ursache

Die Links tragen nur `fontSize` und `textAlign` als Inline-Style, keine
Farbe — und `app/nocturne.css` enthält keine `a`-Regel. Damit greift der
Browser-Default: unbesuchte Links blau, besuchte lila. Der Unterschied
zwischen den beiden Links ist also nur, dass einer bereits besucht wurde.

Betroffen sind alle Auth-Seiten, nicht nur der eine Link:
- `app/login/page.tsx` (Links auf /register und /recovery)
- `app/register/page.tsx` (Link auf /login)
- `app/recovery/page.tsx` (Link auf /login)

Sinnvoll wäre eine gemeinsame Regel (z.B. in `app/nocturne.css`), damit
das nicht pro Seite einzeln gepflegt werden muss und künftige Auth-Seiten
es automatisch erben — inklusive `:visited`, sonst tritt genau dieser
Effekt wieder auf.
