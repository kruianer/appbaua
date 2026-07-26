---
id: req-014
title: Security-Task — Worker prüft Sicherheit eines Repos (max. 1×/Tag)
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
changes: req-010
---

# Goal (Why)

Ich will, dass der Worker pro Repo regelmäßig einen Sicherheits-Check
macht und mir die Ergebnisse als nachlesbaren Bericht ablegt — damit ich
früh sehe, wo Zugriff, Datenschutz, Backup oder verwundbare
Abhängigkeiten nicht zu meinen Vorgaben passen, ohne selbst danach suchen
zu müssen.

# Function (What)

Der Task-Typ "Security" wird als funktionierender wiederkehrender Typ
umgesetzt — analog zu Code-Review (req-006) und Ideen (req-011): kein
ready-.md nötig, höchstens einmal pro Repo und Kalendertag (aus dem
run_log abgeleitet), nur in den P3–P5-Zeitfenstern. Der Task ändert
KEINEN Code.

Pro Lauf:
1. Der Worker liest — falls vorhanden — die Sicherheits-Vorgaben des Repos
   in `delivery/security.md` (Erreichbarkeit intern/extern, HTTPS-Pflicht,
   Zugriffskreis, Backup-Erwartung). Fehlt die Datei, prüft er nach
   allgemeinen Sicherheits-Best-Practices und vermerkt im Bericht, dass
   keine repo-spezifische Vorgabe vorlag.
2. Er prüft vier Bereiche, so tief wie sein für dieses Repo hinterlegter
   Zugriff reicht (mindestens Requirements/Code/Config; wo
   Infrastruktur-Zugriff wie SSH hinterlegt ist, auch live):
   - Zugriff & Erreichbarkeit (passt die tatsächliche Erreichbarkeit zur
     Vorgabe: nur WLAN vs. von außen, HTTPS erzwungen, Auth/Login
     vorhanden, wer darf zugreifen),
   - Datenschutz & Datenhaltung (Secrets/Passwörter/Tokens nicht im Repo,
     Umgang mit personenbezogenen/sensiblen Daten),
   - Backup & Wiederherstellung (Abgleich mit der Backup-Erwartung),
   - Abhängigkeiten & bekannte Lücken (veraltete/verwundbare
     Dependencies, unsichere Default-Konfiguration).
3. Findet er mindestens ein Finding, legt er einen Bericht als
   Markdown-Datei in `delivery/security/` ab, committet und pusht ihn auf
   `dev` (Ablage-Mechanik wie req-010, aber eigener Ordner). Der Bericht
   beginnt mit einer Kurz-Zusammenfassung; jedes Finding trägt einen
   Schweregrad (hoch/mittel/niedrig) und eine konkrete Empfehlung, und
   kennzeichnet, was live verifiziert wurde vs. nur aus Code/Config
   erschlossen.
4. Findet er keine Auffälligkeit, legt er KEINE Bericht-Datei an; im
   Verlauf-Log steht "Security-Check ok".

# Acceptance Criteria

- [ ] Given der Task-Typ "Security" ist aktiv und fällig und lief heute
  für "appbaua" noch nicht, when der Worker ihn ausführt und mindestens
  ein Finding hat, then entsteht in `delivery/security/` eine neue
  Bericht-Datei, die auf `dev` gepusht wird.
- [ ] Given der Security-Task lief heute für "appbaua" bereits, when der
  Worker im selben Kalendertag erneut an "appbaua × Security" kommt, then
  wird der Schritt übersprungen (kein zweiter Lauf am selben Tag).
- [ ] Given der Worker führt einen Security-Check ohne Auffälligkeit
  durch, when der Lauf endet, then wird KEINE Bericht-Datei angelegt und
  im Verlauf steht "Security-Check ok".
- [ ] Given ein Security-Bericht wurde abgelegt, when ich ihn öffne, then
  hat er eine Kurz-Zusammenfassung und Findings, die je einen Schweregrad
  und eine Empfehlung tragen.
- [ ] Given `delivery/security.md` existiert und legt "nur intern im
  WLAN, kein Zugriff von außen" fest, when der Worker eine
  Konfiguration findet, die die App von außen erreichbar macht, then
  erscheint dazu ein Finding im Bericht.
- [ ] Given `delivery/security.md` fehlt, when der Worker den Check
  ausführt, then läuft der Check nach Best-Practices und der Bericht (bei
  Findings) vermerkt, dass keine repo-spezifische Vorgabe vorlag.
- [ ] Given der Dateiname eines Security-Berichts, when ich ihn
  betrachte, then erkenne ich Typ (security), Datum und Repo-Bezug.

# Constraints

- Wie tief der Worker prüfen kann, hängt vom für das jeweilige Repo
  hinterlegten Zugriff ab (Repo-Inhalt immer; Infrastruktur/SSH nur wo
  vorhanden). Die Hinterlegung dieses Zugriffs ist NICHT Teil dieses
  Requirements.

# Out of Scope

- Der Setup-Skill, mit dem `delivery/security.md` erstellt/gepflegt wird —
  wird getrennt eingerichtet (analog setup-stack/setup-devops).
- Automatisches Beheben gefundener Probleme (der Task ändert keinen Code).
- Automatisches Anlegen von Bugs/Requirements aus Findings.
- Hinterlegen/Verwalten von Infrastruktur-Zugängen (SSH-Credentials).
- Ein UI zum Durchblättern der Security-Berichte in der App (nur Dateien
  im Repo).
