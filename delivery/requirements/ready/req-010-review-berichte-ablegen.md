---
id: req-010
title: Worker legt Code-Review-/Doku-Berichte als Datei im Repo ab
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-25
changes: req-006
---

# Goal (Why)

Ich will die Ergebnisse wiederkehrender Analyse-Tasks (Code-Review,
Security-Review, Doku) dauerhaft nachlesen können. Aktuell erzeugt z.B.
ein Code-Review einen ausführlichen Bericht, der aber nirgends abgelegt
wird — er landet nur gekürzt im Verlauf-Log und vollständig in der
flüchtigen Claude-Session im Container und geht damit praktisch verloren.

# Function (What)

Wenn der Worker einen wiederkehrenden Analyse-Task ausführt, der keinen
Code ändert (Code-Review, Security-Review, Doku), legt er den vollen
Bericht als Markdown-Datei im Ziel-Repo ab und pusht ihn auf `dev` — so
wie er bei datei-getriebenen Tasks Code committet. Der Bericht landet in
einem festen Ordner (z.B. `delivery/reviews/`) mit sprechendem
Dateinamen (Typ, Datum, Repo/Commit), damit er auffindbar ist. Das
Verlauf-Log behält wie bisher nur die Kurzmeldung.

# Acceptance Criteria

- [ ] Given der Worker führt einen Code-Review für ein Repo aus, when der
  Schritt erfolgreich endet, then existiert im Ziel-Repo eine neue
  Bericht-Datei (z.B. unter `delivery/reviews/`) mit dem vollständigen
  Bericht, committet und auf `dev` gepusht.
- [ ] Given der Bericht wurde abgelegt, when ich den Dateinamen
  betrachte, then erkenne ich Typ, Datum und Bezug (Repo bzw. Commit).
- [ ] Given ein wiederkehrender Task hat einen Bericht abgelegt, when ich
  den Verlauf-Eintrag ansehe, then steht dort weiterhin nur die
  Kurzmeldung (der volle Bericht ist in der Datei, nicht im Log).

# Out of Scope

- Berichte für datei-getriebene Tasks (Bugs/Requirements) — dort wird
  Code committet, nicht ein Bericht.
- Ein UI zum Durchblättern der Berichte in der App (nur die Datei im
  Repo).
- Formatvorgaben für den Berichtsinhalt selbst (Claude formuliert frei).
