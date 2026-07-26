---
id: req-018
title: Repo-Umstellung rollt auch den site-Ordner aus
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-07-26
changes: req-012
---

# Goal (Why)

Seit es die Web-Ausgaben unter `site/` gibt (Benutzer-Doku und später
technische Doku / öffentliche Website), muss ein Repo, das ich auf den
appbaua-Standard umstelle, auch diese Ordnerstruktur bekommen — sonst
hat ein umgestelltes Repo zwar den Doku-Task, aber keinen Ort, an den er
schreibt.

# Function (What)

Erweitert die Repo-Umstellung aus req-012. Zusätzlich zu den Skills und
der `delivery/`-Struktur rollt die Umstellung künftig auch den
`site/`-Ordner aus — nach exakt denselben Regeln wie die
`delivery/`-Struktur:

- Die Funktion liest ZUR LAUFZEIT die Ordner unter `site/` des
  appbaua-Repos (z.B. `site/user-docs/`, `site/tech-docs/`, `site/www/`)
  — nichts ist fest verdrahtet; kommen später weitere Unterordner hinzu,
  werden sie automatisch mit ausgerollt.
- Sie werden als LEERE Struktur im Zielrepo angelegt; fehlende Ordner
  werden ergänzt, vorhandene inklusive ihres Inhalts bleiben unberührt.

Alles Übrige an der Umstellung bleibt unverändert (Skills, `delivery/`,
CLAUDE.md nur falls fehlend, Idempotenz, Abbruch ohne Push bei Fehler,
Branch-Wahl aus req-013). Die neuen Setup-Skills (z.B. setup-doc-site)
kommen bereits über die bestehende dynamische Skill-Ausrollung mit — dafür
ist keine weitere Änderung nötig.

# Acceptance Criteria

- [ ] Given das appbaua-Repo hat einen Ordner `site/user-docs/` und ein
  Zielrepo hat noch keinen `site/`-Ordner, when ich das Zielrepo umstelle,
  then existiert danach im Zielrepo die leere `site/`-Struktur inkl. der
  Unterordner, die es in appbaua gibt.
- [ ] Given im appbaua-Repo kommt später ein Ordner `site/www/` hinzu,
  when ich ein Repo umstelle, then wird `site/www/` mit ausgerollt, ohne
  dass dafür etwas fest verdrahtet werden musste.
- [ ] Given ein Zielrepo hat bereits `site/user-docs/` mit einer fertigen
  Doku-Datei darin, when ich es umstelle, then bleibt diese Datei erhalten
  (der Ordner wird nicht geleert).
- [ ] Given ich stelle ein Repo um, when die Umstellung läuft, then wird
  der Skill `setup-doc-site` mit ausgerollt (über die bestehende
  Skill-Ausrollung), ohne dass es dafür eine gesonderte Regel braucht.

# Out of Scope

- Kopieren von Inhalten der site-Ordner (z.B. die appbaua-eigene Doku) —
  wie bei `delivery/` wird nur die leere Struktur ausgerollt.
- Änderungen an der delivery-Ausrollung oder den übrigen Regeln von
  req-012/req-013.
