---
project: appbaua
setup: 1
---

# DevOps Convention

Diese Datei ist verbindlich für den autonomen Worker. Befolge sie exakt.

## Environments

| Environment | Branch | URL                     |
|-------------|--------|-------------------------|
| dev         | dev    | https://dev.appbaua.com |
| prod        | main   | https://app.appbaua.com |

Hosting-Plattform: GitHub Actions (Runner auf Beelink EQR5 Mini-PC,
Ubuntu). Der Deploy läuft als GitHub-Actions-Workflow, ausgelöst durch
den Push — kein PaaS-Auto-Deploy, aber dieselbe Wirkung: git push ist der
Trigger.

## Konfiguration pro Umgebung (req-023)

`APP_ORIGIN` muss in `deploy/dev.env` und `deploy/prod.env` (nicht im
Repo, siehe docker-compose.yml) auf die jeweils eigene URL oben gesetzt
sein — `https://dev.appbaua.com` bzw. `https://app.appbaua.com`. Passkeys
sind an diesen Wert gebunden (WebAuthn rpId); stünde in beiden envs
dieselbe URL, würde ein auf dev registrierter Passkey fälschlich auch auf
prod versucht (und WebAuthn selbst lehnt das dann ab — kein Login mehr
möglich, bis der Wert korrigiert ist).

## Externer Zugang über Cloudflare Tunnel (req-024)

Beide Umgebungen — dev UND prod — sind über je einen eigenen Cloudflare
Tunnel von außen erreichbar, ohne offenen Port am Router. Der App-
Container bleibt zusätzlich im WLAN direkt über `APP_PORT` erreichbar;
der Tunnel kommt als zweiter, unabhängiger Zugangsweg hinzu.

**Einmalige manuelle Konto-Schritte (macht der Nutzer, nicht der
Worker):**

1. Die Zone `appbaua.com` bei Cloudflare anlegen (falls noch nicht
   geschehen) und die Nameserver beim Registrar auf die von Cloudflare
   genannten umstellen.
2. Im Cloudflare-Dashboard unter Zero Trust → Networks → Tunnels **zwei**
   Tunnel anlegen — einen für dev, einen für prod (getrennte Tunnel,
   getrennte Tokens, damit ein Ausfall/eine Rotation den jeweils anderen
   nicht berührt).
3. Für jeden Tunnel eine Public Hostname zuweisen: `dev.appbaua.com` →
   der dev-Tunnel, `app.appbaua.com` → der prod-Tunnel, jeweils auf
   Service `http://app:3000` (Compose-interner Servicename/Port, siehe
   docker-compose.yml).
4. Je Tunnel den angezeigten Token kopieren und als `CLOUDFLARE_TUNNEL_TOKEN`
   in `deploy/dev.env` bzw. `deploy/prod.env` eintragen — NICHT ins Repo
   committen (diese env-Dateien sind bewusst nicht versioniert, siehe
   Compose-Datei-Kopf).

**Danach automatisch:** `docker compose up -d` (Teil des bestehenden
Deploy-Workflows) startet den `cloudflared`-Dienst mit; er hält die
ausgehende Verbindung zu Cloudflare, worüber die jeweilige Domain die App
erreicht. Kein Eingriff in Router/Firewall nötig.

## Notfall: ausgesperrt (Passkey UND Backup-Codes verloren)

Der Passkey-Schutz (req-023) richtet sich gegen jemanden, der nur die URL
kennt — nicht gegen den Betreiber der Maschine. Wer SSH-Zugang zum
Beelink hat, kommt immer wieder herein. Drei Stufen, von harmlos nach
radikal:

**Stufe 1 — Passkey weg, Backup-Code vorhanden.** Der normale Weg:
`/recovery` aufrufen, Code eingeben, neuen Passkey registrieren. Dafür
sind die Codes da.

**Stufe 2 — beides weg.** Per SSH auf dem Beelink alle Auth-Nutzer der
betroffenen Umgebung löschen; danach ist sie wieder „jungfräulich"
(`bootstrapped: false`) und die Login-Seite zeigt erneut
„Ersteinrichtung starten":

```bash
# <ENV> ist dev oder prod; USER/DB aus der jeweiligen deploy/<env>.env
docker compose -p appbaua-<ENV> exec db \
  psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c "DELETE FROM auth_users;"
```

Wegen `ON DELETE CASCADE` verschwinden Credentials, Sessions,
Einladungen und Backup-Codes automatisch mit. **Nur** Auth-Daten sind
betroffen — Repos, Task-Typen, Verlauf und Worker-Status liegen in
anderen Tabellen und bleiben unangetastet.

**Stufe 3 — DB-Zugang unklar.** Notfalls den Stack mit frischem
DB-Volume neu aufsetzen. Das ist praktisch nie nötig; Stufe 2 reicht.

**Konsequenz für den Alltag:** Backup-Codes trotzdem sichern (am besten
im Passwortmanager). Stufe 2 ist der Notausgang, nicht der reguläre Weg —
sie kostet den kompletten Auth-Zustand der Umgebung, inklusive aller
eingeladenen Nutzer.

## Deploy Trigger

- Push auf `dev`   → Workflow deployt automatisch die dev-Umgebung.
- Merge auf `main` → Workflow deployt automatisch prod.

Kein manueller Deploy-Schritt; der git push ist der Trigger.

## Promotion (dev → prod)

- Promotion passiert AUSSCHLIESSLICH über einen Pull Request von `dev`
  nach `main`.
- Standardfall: NUR der Nutzer merged diesen PR. Der Worker öffnet ihn
  höchstens; er merged nie nach `main` und deployt nie selbst nach prod.
- Ausnahme (nur auf ausdrücklichen Wunsch): Bittet der Nutzer in einer
  konkreten Sitzung ausdrücklich darum, darf der Worker die Promotion für
  ihn ausführen (PR nach `main` mergen bzw. den Deploy nach prod
  auslösen). Diese Erlaubnis gilt NUR für die eine genannte Promotion —
  sie ist kein Dauer-Freibrief und nichts, was automatisch/unaufgefordert
  geschieht. Im Zweifel bleibt es beim Standardfall.
- Auch bei der Ausnahme gilt das Quality Gate unten unverändert: Der
  Nutzer muss die Änderung auf der dev-URL abgenommen haben und die
  Test-Suite muss grün sein.

## Acceptance / Quality Gate

- Der Nutzer nimmt Änderungen auf der dev/Staging-URL oben ab, bevor
  promotet wird.
- Eine Änderung, die auf der dev-URL nicht manuell überprüfbar ist, ist
  nicht fertig.

## Hard Rules

- Der Worker committet nur auf `dev`.
- Der Worker deployt nicht von sich aus nach prod, merged nicht von sich
  aus nach `main` und pusht nie direkt auf `main` (immer über PR). Nach
  prod/`main` geht es nur, wenn der Nutzer in der Sitzung ausdrücklich
  darum bittet — siehe Ausnahme unter „Promotion". Ohne diesen
  ausdrücklichen Wunsch bleibt prod/`main` für den Worker tabu.
- Nie autonom/unaufgefordert nach prod deployen oder auf `main` mergen —
  das passiert ausschließlich auf ausdrücklichen Wunsch des Nutzers.
