---
id: bug-040
app: appbaua
req: req-040
priority: high
created: 2026-10-21
---

# Observed

Die Arbeitskopie, in der Claude im Chat arbeitet, wird zwischen zwei
Nachrichten des Betreibers hart auf den Stand von `origin/dev`
zurückgesetzt. Was Claude committet, aber noch nicht gepusht hat, ist
in der nächsten Runde aus dem Branch verschwunden. Das gilt auch für
nicht committete Änderungen.

Beispiel vom 2026-10-21 im Repo appbaua: Claude legt den Entwurf
req-050 an und committet ihn nach `delivery/requirements/draft/`, so
wie es der Skill capture-requirement vorsieht. Nach der nächsten
Nachricht des Betreibers ist der Commit nicht mehr im Branch. Im
`git reflog` steht "reset: moving to origin/dev". Der Commit ließ sich
nur über das Reflog retten.

# Expected

Die Arbeitskopie eines Repos im Chat behält ihren Stand über das ganze
Gespräch hinweg, wie eine Sitzung am Rechner (req-040): Lokale Commits
und Änderungen bleiben erhalten, bis Claude sie pusht oder selbst
verwirft. Den Stand des Remotes holt Claude selbst per `git pull`, die
App überschreibt dabei nichts.
