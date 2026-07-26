---
id: req-023
title: Passkey-Anmeldung — Zugangsschutz für die Worker-App
app: appbaua
area: Zugang & Sicherheit
priority: high
created: 2026-07-26
---

# Goal (Why)

Die Worker-App steuert meinen autonomen Worker und ist von außen
erreichbar — aktuell aber ungeschützt: Wer die URL kennt, kommt rein. Ich
will einen sicheren, passwortlosen Zugang per Passkey, sodass nur
berechtigte Personen die App bedienen können.

# Function (What)

Eine vollständige Passkey-Anmeldung (WebAuthn) wird der App
vorangestellt. Fachlicher Umfang orientiert sich an der bewährten Lösung
aus livinggardentwin (auth-001/auth-002) — als inhaltliche Vorlage, aber
NEU für appbauas Stack (Next.js/TypeScript) gebaut, KEIN Code kopiert.

Leitprinzip **Person ≠ Betreiber-Kontext**: Wer sich anmeldet, ist ein
Nutzer mit einem oder mehreren Passkeys; die App wird im Kontext eines
Betreibers bedient. (Vorerst ein Betreiber, ein Nutzer — n:m-fähig
gedacht, aber nicht ausgebaut.)

Umfang:
- **Passkey-Registrierung und -Login** (WebAuthn): ein Nutzer kann einen
  oder mehrere Passkeys (mehrere Geräte) registrieren und sich damit
  anmelden.
- **Betreiber-Bootstrap:** Ein bewusst aufgerufener, einmaliger Schritt
  legt in einer leeren Umgebung den ersten Betreiber-Nutzer an, mit dem
  der erste Passkey registriert wird. Läuft nicht automatisch/über Seed.
- **Einladung:** Weitere Nutzer kommen nur über eine Einladung des
  Betreibers hinzu (keine offene Selbstregistrierung).
- **Recovery:** Backup-Codes, mit denen ein Nutzer wieder Zugang bekommt,
  wenn er sein Passkey-Gerät verliert.
- **Session:** Nach dem Login besteht eine Sitzung (Session-Cookie);
  Logout beendet sie.
- **Schutz der gesamten App:** Ohne gültige Sitzung ist NUR die
  Anmelde-/Registrierungs-/Recovery-Oberfläche erreichbar. Die gesamte
  Worker-Steuerung (Repos, Task-Steuerung, Hauptschalter, Dashboard,
  Aktivität, Verlauf, Einstellungen) ist erst nach Login zugänglich.
- **rpId/Origin konfigurierbar:** Die WebAuthn-Domain (rpId) und die
  erlaubten Origins sind Konfiguration (Dev-Umgebung vs.
  app.appbaua.com), nicht fest verdrahtet — damit Passkeys auf dev und
  prod getrennt funktionieren.

# Acceptance Criteria

- [ ] Given eine leere Umgebung ohne Nutzer, when der Betreiber-Bootstrap
  einmalig ausgeführt wird, then existiert ein Betreiber-Nutzer, mit dem
  ein erster Passkey registriert werden kann.
- [ ] Given ich habe einen Passkey registriert, when ich mich mit ihm
  anmelde, then erhalte ich eine gültige Sitzung und sehe die
  Worker-Steuerung.
- [ ] Given ich bin nicht angemeldet, when ich eine geschützte Seite
  (z.B. die Repo-Verwaltung) direkt aufrufe, then sehe ich stattdessen
  die Anmeldeseite und NICHT die Worker-Steuerung.
- [ ] Given ich bin angemeldet, when ich mich abmelde, then ist die
  Worker-Steuerung wieder gesperrt und ich sehe die Anmeldeseite.
- [ ] Given ich bin als Betreiber angemeldet, when ich eine Einladung
  erstelle, then kann eine weitere Person darüber einen eigenen Passkey
  registrieren.
- [ ] Given eine offene, nicht-eingeladene Person, when sie sich ohne
  Einladung zu registrieren versucht, then wird das abgelehnt (keine
  offene Selbstregistrierung).
- [ ] Given ich habe mein Passkey-Gerät verloren, when ich einen gültigen
  Backup-Code verwende, then bekomme ich wieder Zugang und kann einen
  neuen Passkey registrieren.
- [ ] Given ich registriere einen Passkey auf der dev-Umgebung, when ich
  mich auf app.appbaua.com anmelden will, then gilt der dev-Passkey dort
  NICHT (rpId/Origin sind getrennt).

# Constraints

- WebAuthn/Passkeys funktionieren nur im "secure context" (HTTPS) — auf
  allen über das Netz erreichbaren Umgebungen ist gültiges TLS
  Voraussetzung (stack.md). Für lokale Entwicklung gilt localhost als
  sicher.

# Out of Scope

- Externer Zugang / Cloudflare Tunnel auf app.appbaua.com — eigenes
  Folge-Requirement (req-024), das auf dieser Anmeldung aufbaut.
- Mehrere Betreiber-Kontexte / Rollen / Rechteverwaltung über den einen
  Betreiber hinaus — n:m ist gedacht, aber nicht ausgebaut.
- Offene öffentliche Selbstregistrierung, E-Mail-Magic-Link.
- Passwort-Login als Alternative zu Passkeys.
