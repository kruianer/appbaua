---
id: req-025
title: Test-Gate unterscheidet rote Tests von nicht ausführbaren Tests
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-26
changes: req-019
---

# Goal (Why)

Das Test-Gate (req-019) soll ein Requirement nur dann als fehlgeschlagen
werten, wenn Tests tatsächlich ROT sind — nicht schon dann, wenn gar kein
ausführbarer Test-Befehl existiert. Sonst scheitert in einem noch
code-losen Gerüst-Repo oder einem Repo, dessen Test-Werkzeug im
Worker-Container nicht installiert ist, JEDES Requirement am Gate, obwohl
die eigentliche Arbeit erledigt wurde (aktuell passiert bei
livinggardenkeeper: "Test-Suite rot, kein ausführbarer Befehl").

# Function (What)

Ergänzt das Test-Gate aus req-019 um eine Unterscheidung, bevor ein
Requirement wegen der Tests nach failed/ wandert:

- **Tests laufen und schlagen fehl (rot):** unverändert wie req-019 — der
  Fix-Versuch greift, bleibt es rot, geht die .md nach failed/.
- **Kein Test-Befehl vorhanden ODER Befehl nicht ausführbar** (in
  stack.md kein Test-Befehl definiert, oder das Test-Werkzeug ist nicht
  vorhanden / "command not found"): Das gilt NICHT als roter Fehlschlag.
  Die Änderung darf trotzdem als erledigt gelten (done/), aber der
  Verlaufs-Eintrag vermerkt sichtbar "Tests nicht ausführbar — ungeprüft".

Die Grenze ist bewusst eng: Nur ein FEHLENDER oder ein NICHT AUSFÜHRBARER
Befehl wird durchgelassen. Ein Test-Befehl, der startet und dann
fehlschlägt (echte rote Tests), blockiert weiterhin wie in req-019.

# Acceptance Criteria

- [ ] Given ein Repo, dessen stack.md keinen Test-Befehl definiert, when
  der Worker ein Requirement dort umsetzt, then geht die .md nach done/
  und der Verlauf vermerkt "Tests nicht ausführbar — ungeprüft" (nicht
  nach failed/).
- [ ] Given ein Repo, dessen Test-Befehl auf ein im Container nicht
  installiertes Werkzeug verweist (z.B. "command not found"), when der
  Worker ein Requirement umsetzt, then geht die .md nach done/ mit dem
  Vermerk "Tests nicht ausführbar — ungeprüft".
- [ ] Given ein Repo mit lauffähiger Test-Suite, die nach der Änderung
  ROT ist, when der Worker das Requirement abschließt und den Fix nicht
  hinbekommt, then geht die .md nach failed/ (unverändert zu req-019).
- [ ] Given ein Repo mit lauffähiger Test-Suite, die grün ist, when der
  Worker das Requirement abschließt, then geht die .md nach done/ OHNE den
  "ungeprüft"-Vermerk.
- [ ] Given ein Lauf, der als "Tests nicht ausführbar — ungeprüft"
  abgeschlossen wurde, when ich den Verlauf ansehe, then erkenne ich, dass
  hier NICHT getestet wurde (der Vermerk ist sichtbar).

# Out of Scope

- Automatisches Anlegen/Erraten eines Test-Befehls für ein Repo ohne
  Tests — der Worker legt keine Tests an, er erkennt nur die
  Nicht-Ausführbarkeit.
- Änderung daran, WAS als grün/rot gilt, wenn der Befehl tatsächlich
  läuft — das bleibt wie in stack.md/req-019 definiert.
- Der livinggardenkeeper-spezifische Fall (colcon/ROS) im Einzelnen —
  dieses Requirement löst das generisch für alle Repos.
