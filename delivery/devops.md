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

## Telegram-Meldungen und -Befehle (req-033)

appbaua meldet einen Ausfall einer überwachten App per Telegram und nimmt
über denselben Chat `/status` und `/neustart` entgegen. Ohne die beiden
Variablen unten passiert davon nichts — die Überwachung selbst
(req-032) läuft unverändert weiter.

**Einmalige manuelle Konto-Schritte (macht der Nutzer, nicht der
Worker):**

1. In Telegram `@BotFather` anschreiben, `/newbot`, Namen vergeben. Er
   gibt den Bot-Schlüssel aus.
2. Dem neuen Bot einmal selbst schreiben (z.B. `/start`), damit ein Chat
   existiert.
3. `https://api.telegram.org/bot<SCHLÜSSEL>/getUpdates` aufrufen und die
   `chat.id` aus der Antwort notieren.
4. Beides als `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` in
   `deploy/dev.env` bzw. `deploy/prod.env` eintragen — NICHT ins Repo
   committen.

**Je Umgebung ein eigener Bot.** Sonst kämen dev und prod im selben Chat
an, und eine Meldung ließe nicht erkennen, welche Umgebung sie betrifft —
bei `/neustart` wäre das der Unterschied zwischen einem Testsystem und
einem laufenden prod-Container.

**Was den Bot schützt.** Nichts außer der Chat-Kennung: ein Bot ist
öffentlich ansprechbar, jeder der seinen Namen kennt kann ihm schreiben.
appbaua antwortet ausschließlich auf Nachrichten aus dem hinterlegten
Chat und verwirft alle anderen wortlos. Der Schlüssel gehört deshalb
genauso behandelt wie der GitHub-Token.

## Ausfallwächter beim Webhoster (req-034)

Die Meldungen aus req-033 laufen auf demselben Beelink wie die überwachten
Apps. Fällt dieser Rechner selbst aus — Strom, Internet, appbaua tot —,
fällt der Melder mit ihm weg und niemand erfährt davon. Genau dagegen
steht ein winziger PHP-Wächter beim Webhoster (all-inkl): appbaua meldet
sich alle paar Minuten bei ihm, und bleibt diese Meldung länger als 15
Minuten aus, schickt **er** die Telegram-Nachricht.

Er beantwortet nur eine Frage — lebt der Rechner noch? Über die
überwachten Apps weiß er nichts, prüft nichts selbst und steuert nichts.
Fällt der Hoster selbst aus, gibt es keine Meldung; dieser Fall bleibt
bewusst offen.

**Einmalige manuelle Schritte (macht der Nutzer, nicht der Worker):**
Die Dateien liegen im Repo unter `watchdog/`, die vollständige Anleitung
in [../watchdog/README.md](../watchdog/README.md). In Kurzform:

1. `watchdog/private/*` in ein Verzeichnis **außerhalb** des
   Web-Verzeichnisses hochladen, `watchdog/public/*` hinein.
2. `config.php` aus `config.sample.php` anlegen — Bot-Schlüssel und
   Chat-Kennung wie oben, dazu eine frisch erzeugte Kennung für den
   Herzschlag. Diese Datei gehört NIE ins Repo.
3. `WATCHDOG_URL` und `WATCHDOG_TOKEN` in `deploy/dev.env` bzw.
   `deploy/prod.env` eintragen und die Umgebung neu deployen.
4. Im Kundenmenü des Hosters (KAS → Cronjobs) einen Cronjob alle 5
   Minuten auf `check.php` anlegen. Ohne ihn merkt niemand, dass der
   Herzschlag ausblieb — der Hoster bietet keine Hintergrunddienste.

**Je Umgebung ein eigener Wächter**, mit eigener Kennung und eigenem
`label`. Sonst hielte ein laufendes dev den prod-Rechner für lebendig.

**Kontrolle:** Die Zustandsseite von appbaua zeigt oben, wann der Wächter
den letzten Herzschlag angenommen hat. Ein gescheiterter Versand steht
zusätzlich im Verlauf.

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
