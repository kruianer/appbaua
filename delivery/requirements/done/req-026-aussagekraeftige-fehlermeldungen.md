---
id: req-026
title: Fehlgeschlagene Läufe nennen Phase, Befehl und Ausgabe-Auszug
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-26
changes: req-004, req-019
---

# Goal (Why)

Wenn ein Worker-Lauf fehlschlägt, will ich im Verlauf sofort sehen, WORAN
es lag — ohne selbst lange analysieren zu müssen. Zuletzt stand nur
"Test-Suite rot" bzw. "Timeout" im Verlauf; die eigentliche Ursache
(welcher Befehl, welche Ausgabe, welche Phase) war nur durch aufwändige
Nachforschung im Code/Repo zu ermitteln.

# Function (What)

Der Verlaufs-Eintrag eines fehlgeschlagenen Laufs wird aussagekräftiger.
Er nennt:

1. **Die Fehlerphase** — in welchem Schritt es scheiterte: Repo
   vorbereiten / Claude-Lauf / Tests (Test-Gate, req-019) / Commit-Push.
   So ist die Kategorie sofort erkennbar.
2. **Den konkreten Befehl + einen Ausgabe-Auszug** — bei einem Test-/
   Build-/Befehls-Fehlschlag: welcher Befehl ausgeführt wurde und die
   letzten Zeilen seiner Ausgabe (z.B. "colcon: command not found" oder
   die rote Testzeile). Ein kurzer, lesbarer Auszug, keine seitenlange
   Ausgabe.
3. **Bei Timeout: die letzte Aktivität** — wenn der Lauf ins Zeitlimit
   läuft, wird die zuletzt gesehene Aktivität/Ausgabe festgehalten, damit
   erkennbar ist, ob der Lauf an einer Drosselung (Rate-Limit) hing oder
   tatsächlich beschäftigt war.

Die Fehlermeldung bleibt eine kompakte, im Verlauf lesbare Zeile (bei
Bedarf mehrzeilig), kein separater Berichts-Datei-Mechanismus. Sensible
Inhalte (Tokens/Secrets) werden wie bisher aus der Meldung entfernt
(bestehende Redaction, bug-003).

# Acceptance Criteria

- [ ] Given ein Lauf scheitert beim Vorbereiten des Repos, when ich den
  Verlaufs-Eintrag ansehe, then nennt er die Phase "Repo vorbereiten" und
  den Grund.
- [ ] Given ein Lauf scheitert am Test-Gate, weil der Test-Befehl nicht
  ausführbar ist, when ich den Eintrag ansehe, then nennt er die Phase
  "Tests", den ausgeführten Befehl und einen Ausgabe-Auszug (z.B.
  "command not found").
- [ ] Given eine lauffähige Test-Suite ist nach der Änderung rot, when
  der Lauf fehlschlägt, then nennt der Eintrag die Phase "Tests" und
  einen Auszug der roten Testausgabe (nicht nur "Test-Suite rot").
- [ ] Given ein Lauf läuft in den 60-Minuten-Timeout, when ich den
  Eintrag ansehe, then nennt er die Phase, dass ein Timeout eintrat, und
  die zuletzt gesehene Aktivität/Ausgabe.
- [ ] Given ein fehlgeschlagener Lauf, dessen Ausgabe ein Token/Secret
  enthielt, when ich den Eintrag ansehe, then ist das Secret NICHT
  sichtbar (Redaction bleibt aktiv).

# Out of Scope

- Ein separater Fehler-Bericht als Datei im Repo (analog req-010) — die
  aussagekräftige Verlaufs-Zeile genügt.
- Änderung daran, WANN ein Lauf als Fehlschlag gilt (das regeln
  req-019/req-025) — hier geht es nur um die Aussagekraft der Meldung.
- Vollständiges, dauerhaftes Speichern der kompletten Claude-Ausgabe.
