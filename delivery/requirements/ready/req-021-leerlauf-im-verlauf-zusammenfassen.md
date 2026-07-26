---
id: req-021
title: Leerlauf-Läufe im Verlauf zu einem Eintrag zusammenfassen
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
changes: req-004
---

# Goal (Why)

Ich will, dass der Verlauf nicht von "nichts zu tun"-Einträgen geflutet
wird. Wenn der Worker mehrere Tage nichts zu tun hat und alle 5 Minuten
prüft, entstehen sonst hunderte identische Zeilen, und die echten
Einträge (Erfolg/Fehler) gehen darin unter.

# Function (What)

Ändert das Verlaufs-Verhalten aus req-004 für leere Durchläufe.

Solange der Worker nur leere Durchläufe hat (nichts zu tun gefunden),
schreibt er NICHT bei jedem 5-Minuten-Takt einen neuen Verlaufs-Eintrag,
sondern hält EINEN einzigen zusammengefassten Leerlauf-Eintrag aktuell:

- Der Eintrag zeigt den Zeitraum und die letzte Prüfung, z.B. "Nichts zu
  tun seit 24.07. 09:00 — zuletzt geprüft 26.07. 14:35". Bei jedem weiteren
  leeren Durchlauf wird nur die "zuletzt geprüft"-Zeit dieses einen
  Eintrags aktualisiert.
- Der Eintrag trägt einen eigenen, neutralen Status "Leerlauf" (gedämpft
  dargestellt), klar unterscheidbar von "Erfolg" und "Fehler".
- Läuft echte Arbeit dazwischen (ein Schritt mit Erfolg oder Fehler),
  steht diese wie bisher als eigene Zeile im Verlauf. Die nächste
  Leerlauf-Phase beginnt danach einen NEUEN zusammengefassten
  Leerlauf-Eintrag (der alte wächst nicht weiter).

Bereits bestehende alte "nichts zu tun"-Einträge bleiben unverändert
stehen; die Zusammenfassung greift nur für künftige Leerlauf-Läufe.

# Acceptance Criteria

- [ ] Given der Worker hat nichts zu tun und prüft mehrfach hintereinander
  (alle 5 Minuten), when ich den Verlauf ansehe, then steht dafür genau
  EIN Leerlauf-Eintrag (nicht einer pro Prüfung).
- [ ] Given ein bestehender Leerlauf-Eintrag und ein weiterer leerer
  Durchlauf, when ich den Eintrag ansehe, then ist nur seine "zuletzt
  geprüft"-Zeit aktualisiert und der Startzeitpunkt des Zeitraums
  unverändert.
- [ ] Given ein Leerlauf-Eintrag, when ich ihn im Verlauf ansehe, then
  trägt er den Status "Leerlauf" und ist von "Erfolg"/"Fehler" optisch
  unterscheidbar.
- [ ] Given eine laufende Leerlauf-Phase, when dann ein echter Schritt mit
  Erfolg oder Fehler läuft, then erscheint dieser als eigene Zeile und ein
  danach folgender leerer Durchlauf beginnt einen NEUEN Leerlauf-Eintrag
  (der vorige wird nicht weiter aktualisiert).
- [ ] Given mehrere Tage durchgehender Leerlauf, when ich den Verlauf
  ansehe, then sehe ich dafür NICHT viele Einträge, sondern den einen
  laufenden Leerlauf-Eintrag.

# Out of Scope

- Nachträgliches Aufräumen/Zusammenfassen bereits bestehender alter
  "nichts zu tun"-Einträge — die bleiben, wie sie sind.
- Die Pause-Anzeige/-Dauer selbst (der 5-Minuten-Takt und die
  "Pause bis HH:MM"-Anzeige bleiben unverändert).
- Ein Filter/Schalter zum Ausblenden im Verlauf-Tab.
