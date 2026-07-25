---
id: bug-003
title: GitHub-Token landet im Klartext in .git/config und potenziell im sichtbaren Verlauf-Log
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-25
relates: req-006
quelle: Code-Review 2026-07-25 (Punkt 4)
---

# Beobachtetes Verhalten

`tokenUrl` (`lib/workspace.ts:78`) baut den GITHUB_TOKEN (PAT) direkt in
die Remote-URL ein; `git remote set-url` (`:110`) schreibt ihn damit im
Klartext in die `.git/config` des Arbeitsverzeichnisses. Zusätzlich wird
git-stderr unverändert weitergereicht und geloggt: `clone failed:
${clone.stderr}` (`:108`) → `Repo vorbereiten fehlgeschlagen: …`
(`lib/execute-step.ts:91`) → run_log → im UI sichtbar
(`components/RunLog.tsx:120`); ebenso `push failed: ${push.stderr}`
(`:143`). Ob git die Credentials in einer konkreten Fehlermeldung
redigiert, ist versionsabhängig — darauf sollte man sich nicht verlassen.

# Erwartetes Verhalten

Der Token steht nicht im Klartext in `.git/config` und erscheint nicht in
Fehlermeldungen, die ins Verlauf-Log bzw. ins UI gelangen.

# Vorgeschlagene Lösung (aus dem Review)

- Auth über `git -c http.extraHeader="Authorization: Basic …"` statt in
  der Remote-URL.
- git-Ausgaben (stdout/stderr) vor dem Loggen durch einen
  Redaction-Filter schicken, der Tokens/Credentials entfernt.

# Akzeptanzkriterien

- [ ] Given der Worker klont/pusht ein Repo, when man danach die
  `.git/config` des Arbeitsverzeichnisses ansieht, then steht der
  GITHUB_TOKEN dort NICHT im Klartext.
- [ ] Given ein git-Befehl schlägt fehl und die Meldung wird geloggt,
  when ich den Verlauf-Eintrag im UI lese, then enthält er KEINEN Token
  bzw. keine Credentials im Klartext.

# Out of Scope

- Wechsel des Authentifizierungsmechanismus gegenüber GitHub (weiterhin
  PAT, nur nicht in der URL/den Logs).
