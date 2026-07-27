---
id: bug-014
app: appbaua
priority: normal
created: 2026-07-27
---

# Observed

Der Worker kann seine Arbeit nicht pushen, wenn sie eine
GitHub-Actions-Workflow-Datei anlegt oder ändert. Zweimal passiert bei
LivingGardenKeeper (27.07., 04:22 und 05:14 UTC):

```
Push fehlgeschlagen (LivingGardenKeeper): push failed:
 ! [remote rejected] main -> main (refusing to allow a Personal Access
   Token to create or update workflow `.github/workflows/ci.yml` without
   `workflow` scope)
error: failed to push some refs
```

Die eigentliche Arbeit war getan — nur der Push scheiterte, also ging der
ganze Lauf als Fehler aus.

# Expected

Der Worker kann auch Änderungen an `.github/workflows/*` pushen. Ein
Requirement, das eine CI-Datei anlegt (wie hier "CI: Quality Gate für
CAD-Build, Tests und Lint"), darf nicht daran scheitern.

# Steps

1. Ein Requirement bearbeiten lassen, das eine Datei unter
   `.github/workflows/` anlegt oder ändert.
2. Der Push wird von GitHub abgelehnt, der Lauf endet als Fehler.

# Hinweis zur Ursache

Kein Code-Fehler, sondern eine Berechtigung: Der `GITHUB_TOKEN`, mit dem
der Worker pusht (aus `~/appbaua-env/*.env` auf dem Beelink), hat den
`workflow`-Scope nicht. GitHub lehnt Pushes, die Workflow-Dateien
berühren, ohne diesen Scope grundsätzlich ab.

Lösung: Beim Personal Access Token den Scope `workflow` ergänzen (bzw.
bei einem Fine-grained Token die Berechtigung "Workflows: Read and
write") und den Wert in `dev.env` und `prod.env` aktualisieren. Danach
Container neu starten, damit sie den neuen Wert lesen.

Wenn das bewusst NICHT gewollt ist (Worker soll keine CI-Dateien ändern
dürfen), wäre die Alternative, das im Prompt/den Konventionen
auszuschließen — dann sollte der Worker aber vorher abbrechen statt am
Push zu scheitern.
