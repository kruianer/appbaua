---
id: req-024
title: Externer Zugang zur App über Cloudflare Tunnel (app.appbaua.com)
app: appbaua
area: Zugang & Sicherheit
priority: normal
created: 2026-07-26
---

# Goal (Why)

Ich will die Worker-App sicher von außerhalb meines LAN erreichen — über
app.appbaua.com, ohne einen Port am Router zu öffnen. Der Zugang soll
über einen Cloudflare Tunnel laufen, wie bei livinggardentwin bewährt.

# Function (What)

Die App wird unter `https://app.appbaua.com` von außen erreichbar gemacht
— über einen Cloudflare Tunnel (kein offener Port am Beelink), mit echtem
TLS. Orientierung: livinggardentwins setup-003, aber für appbauas Setup
gebaut.

- **Cloudflare Tunnel:** Ein `cloudflared`-Dienst/Container am Beelink
  hält den Tunnel; `app.appbaua.com` zeigt über Cloudflare auf den
  Tunnel. KEIN Port am Router geöffnet. TLS terminiert an der
  Cloudflare-Edge, der Tunnel ist verschlüsselt.
- **DNS/Zone bei Cloudflare:** Die nötigen Records für app.appbaua.com
  werden bei Cloudflare verwaltet.
- **Manuelle Konto-Schritte gehören dem Nutzer:** Das Anlegen der
  Cloudflare-Zone, das Umstellen der Nameserver und das Erzeugen des
  Tunnel-Tokens macht der Nutzer; diese Schritte stehen als Voraussetzung
  in der Doku. Der Worker baut den Rest (cloudflared-Konfiguration/
  -Container, Einbindung in das Deploy-Setup, Doku).
- **Keine Secrets im Repo:** Tunnel-Token/Credentials liegen NICHT im
  Repository, nur eine Referenz/Beschreibung, wie sie hinterlegt werden.
- **Zusammenspiel mit der Anmeldung:** app.appbaua.com ist nicht
  öffentlich zugänglich — der Zugang wird durch die Passkey-Anmeldung
  (req-023) geschützt; deren rpId/Origin für prod ist app.appbaua.com.

# Acceptance Criteria

- [ ] Given der Cloudflare Tunnel ist eingerichtet und die Konto-Schritte
  sind erledigt, when ich https://app.appbaua.com von außerhalb meines
  LAN aufrufe, then erreiche ich die App über gültiges TLS.
- [ ] Given der Tunnel läuft, when ich die Router-Konfiguration prüfe,
  then ist KEIN eingehender Port für die App geöffnet (Zugang nur über
  den Tunnel).
- [ ] Given ich rufe app.appbaua.com auf und bin nicht angemeldet, when
  die Seite lädt, then lande ich auf der Passkey-Anmeldung (req-023) und
  nicht in der ungeschützten App.
- [ ] Given das Repository, when ich es durchsehe, then enthält es KEINEN
  Tunnel-Token / keine Cloudflare-Credentials im Klartext (nur Referenz/
  Doku).
- [ ] Given die Doku, when ich sie lese, then sind die manuellen
  Konto-Schritte (Zone anlegen, Nameserver, Tunnel-Token) als
  Voraussetzung beschrieben.

# Constraints

- Registrar/Hosting bleiben wie gehabt; nur die DNS-Verwaltung der für
  app.appbaua.com nötigen Records läuft über Cloudflare.
- Baut auf req-023 (Passkey-Anmeldung) auf: der externe Zugang wird nur
  zusammen mit dem Anmeldeschutz produktiv geschaltet.

# Out of Scope

- Die Passkey-Anmeldung selbst (req-023).
- www.appbaua.com (Homepage) und eine Doku-Subdomain — eigene Vorhaben;
  hier nur die App (app.).
- Monitoring/Alerting, WAF-Regeln, CDN-Feintuning — später.
- Änderung der bestehenden Deploy-/Promotion-Regeln (devops.md) über die
  Erreichbarkeit hinaus.
