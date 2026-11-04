---
type: security
repo: AppBaua
commit: 599bcb2
date: 2026-11-04
---

# Security: AppBaua (599bcb2)

Automatisch erstellt vom appbaua-Worker am 2026-11-04.

# Security-Bericht: appbaua (599bcb2)

**Hinweis:** Eine repo-spezifische `delivery/security.md` gibt es nicht. Geprüft habe ich nach allgemeinen Best Practices und gegen das SOLL aus `CLAUDE.md` und `delivery/devops.md`: dev und prod sind bewusst öffentlich erreichbar, der Zugang läuft per Passkey (req-023), Secrets liegen nur außerhalb des Repos.

## Kurz-Zusammenfassung

**Die Authentifizierung beider Umgebungen ist weiterhin wirkungslos, und das steht öffentlich im Internet.**

- **Zugriff ohne Anmeldung:** Ein erfundener Session-Cookie öffnet dev und prod. Das ist heute erneut live belegt.
- **Neu – Repo öffentlich:** `kruianer/appbaua` ist ein öffentliches Repo. Die Security-Berichte mit genau dieser Lücke sind anonym abrufbar. **Auch dieser Bericht landet dort, wenn das Repo nicht vorher auf privat gestellt wird.**
- **Neu – Schadensradius:** Über Chat und Health-Agent reicht der Schaden voraussichtlich über appbaua hinaus bis zu allen Containern auf dem Beelink.
- **Abhängigkeiten:** Next 15.5.21 hat kritische Advisories, darunter Codeausführung in der Bild-API, die ohne Cookie erreichbar ist. **Korrektur zum Vorbericht:** Für diese Lücken reicht schon das kleine Update auf 15.5.29.
- **Keine Abhilfe eingeplant:** Seit dem Bericht vom 28.10. kam kein Code-Commit dazu. `delivery/bugs/ready/` und `delivery/requirements/ready/` sind leer.

**Sofort sinnvoll, ohne Code:**
1. Repo auf privat stellen.
2. Cloudflare Access (nur die E-Mail des Betreibers) vor beide Hostnamen schalten.
3. `next` auf 15.5.29 heben und über den normalen Weg dev → PR → `main` ausrollen.

**Grenzen der Prüfung:**
- Kein SSH-Zugang hinterlegt, Docker und `cloudflared` sind hier nicht verfügbar. Host, Cloudflare-Konfiguration und laufende Container konnte ich nicht direkt prüfen.
- Live-Prüfungen gegen die Apps waren nur lesende GET-Anfragen. Von den Antworten habe ich nur Status und Größe ausgewertet, keine Inhalte.
- Schreibende Endpunkte, Chat und Datenbank habe ich nicht angefasst.

## Findings

### 1. Session-Cookie wird nicht auf Gültigkeit geprüft (Schweregrad: hoch)

- **Befund:** `middleware.ts:38` prüft nur, ob der Cookie vorhanden ist. Der Kommentar in `middleware.ts:4-12` verspricht eine zweite Prüfung in Routen und Seiten. Es gibt sie nur bei einzelnen Auth-Routen über `currentUser()`, die Fach-APIs und die App-Seiten liefern ohne sie aus. Betroffen sind damit die Routen außerhalb von `/api/auth` (insgesamt gibt es 44 unter `app/api`).
- **Live verifiziert am 2026-11-04:**

| Anfrage | dev ohne Cookie | dev erfundener Cookie | prod ohne Cookie | prod erfundener Cookie |
|---|---|---|---|---|
| `/api/repos` | 401 | 200 | 401 | 200 |
| `/api/worker-state` | 401 | 200 | 401 | 200 |
| `/api/run-log` | 401 | 200 | 401 | 200 |
| `/` | 307 | 200 | 307 | 200 |

- **Auswirkung:** Jeder im Internet kann Daten lesen und laut Code auch Worker, Repos und Task-Typen steuern, Container neu starten und den Chat bedienen.
- **Empfehlung:**
  - Sofort Cloudflare Access davorschalten.
  - Einen gemeinsamen Wrapper bauen, der `currentUser()` in jedem nicht-öffentlichen Route-Handler und im App-Layout erzwingt.
  - Einen Test ergänzen, der jede Route unter `app/api` mit gefälschtem Cookie aufruft.
  - Den irreführenden Kommentar korrigieren.
  - Als Bug mit höchster Priorität anlegen und die Live-Prüfung danach wiederholen.

### 2. Chat führt Claude Code ohne Rückfrage im internetzugewandten Container aus (Schweregrad: hoch)

- **Befund:** Die Chat-Route startet Claude mit `--dangerously-skip-permissions` (`lib/claude-runner.ts:579`). `GITHUB_TOKEN` und die schreibbare Claude-Anmeldung stehen dem Container zur Verfügung. Zusammen mit Finding 1 bedeutet das Codeausführung durch Unbekannte, außerdem Diebstahl der Tokens und Pushes in Repos.
- **Verifikation:** nur aus Code/Config erschlossen, bewusst nicht ausgelöst.
- **Empfehlung:**
  - Zuerst Finding 1 beheben.
  - Den Chat in einen eigenen Container ohne Weg zu den Betriebs-Diensten legen.
  - Einen Token nutzen, der auf die nötigen Repos begrenzt ist.

### 3. Health-Agent öffnet den Weg zu allen Containern des Hosts (Schweregrad: hoch, neu in dieser Tiefe)

- **Befund:** Die Trennung über den Agenten schützt nur gegen eine Kompromittierung, die nicht bis zu Netzwerkzugriff reicht. Wer im App-Container Code ausführt, erreicht ihn trotzdem:
  - `agent/index.ts` kennt keine Authentifizierung. Einzige Grenze ist das Compose-Netz, in dem auch `app` und `worker` hängen.
  - Der Aufruf `env` liest jede Umgebungsvariable jedes Containers, den die Engine kennt (`lib/docker.ts:206`). Der Aufruf `logs` tut dasselbe für Logs, `restart` startet Container neu. Eine Beschränkung auf eigene oder freigegebene Container gibt es dort nicht. Auch `docker.env()` filtert nicht.
  - `isAllowedCommand` prüft nur das Programm, nicht die Argumente (`lib/docker.ts:37`). `psql` mit freien Argumenten ist ein vollwertiger Datenbankzugang und kann je nach Konfiguration auch Shell-Befehle absetzen.
- **Auswirkung:** Über Finding 1 und 2 wären Secrets und Datenbanken der übrigen Apps auf dem Beelink erreichbar, nicht nur appbaua selbst.
- **Verifikation:** nur aus Code/Config erschlossen, nicht ausgelöst.
- **Empfehlung:**
  - Den Agenten mit einem gemeinsamen Geheimnis absichern.
  - `env`, `exec`, `logs` und `restart` auf eine Allowlist überwachter Container begrenzen.
  - `env` nur für benötigte Variablennamen freigeben.
  - `exec` auf feste Befehle ohne freie Argumente einschränken.

### 4. Öffentliches Repo enthält ausnutzbare Schwachstellenberichte (Schweregrad: hoch, neu)

- **Befund:** `kruianer/appbaua` ist öffentlich. Ohne Anmeldung waren abrufbar: der Bericht vom 28.10. auf `dev`, ein Bericht vom 21.10. auf `main` sowie `delivery/devops.md`. Unter `delivery/` stehen außerdem Betriebsdetails wie die LAN-IP und der SSH-Benutzer des Beelink (`delivery/ssh-tunnel-anleitung.md:25`) und die E-Mail des Betreibers. Der Worker legt jeden Bericht automatisch dort ab.
- **Verifikation:** live verifiziert (anonymer Abruf über die GitHub-API und raw.githubusercontent.com, alle HTTP 200; `private=false`).
- **Empfehlung:**
  - Das Repo auf privat stellen und den self-hosted Runner danach prüfen.
  - Falls es öffentlich bleiben soll, Berichte außerhalb des Repos ablegen. Die Git-Historie enthält sie dann weiter, sie müsste bereinigt werden.
  - Alle bisherigen Berichte als öffentlich bekannt behandeln.
  - Prüfen, ob es Hinweise auf Missbrauch gibt, zum Beispiel unbekannte Repos, Chat-Verläufe oder Commits. Tokens rotieren, sobald Finding 1 geschlossen ist.

### 5. Abhängigkeiten mit bekannten Lücken (Schweregrad: hoch)

- **Befund:** `npm audit --omit=dev` meldet 5 Advisories (1 kritisch, 4 hoch). Laut `package-lock.json` gilt derselbe Stand auch auf `main`.

| Paket | installiert | Kernproblem |
|---|---|---|
| `next` | 15.5.21 | Codeausführung ohne Anmeldung in der Bild-API (AVIF, SVG), außerdem Cache Poisoning und DoS |
| `sharp` | 0.34.5 | Lücken aus libvips, libheif und librsvg |
| `postcss` | 8.4.31 | Dateizugriff über `sourceMappingURL` |
| `nanoid` | 3.3.16 | Endlosschleife |
| `source-map-js` | 1.2.1 | DoS |

- **Bild-API:** `/_next/image` ist aus der Middleware ausgenommen (`middleware.ts:55`) und antwortet auf beiden Hosts ohne Cookie. Auf dev kam dabei eine Antwort des Bildoptimierers zurück. Externe Bildquellen weist sie ab (400), das erschwert einen Angriff. Ob eine passende Bildquelle innerhalb der App möglich ist, habe ich nicht geprüft, also ist die Lücke nicht ausgeschlossen.
- **Korrektur zum Vorbericht:** Für die `next`-Advisories selbst reicht 15.5.29, das innerhalb von `^15.5.21` liegt. Die Advisory-Datenbank nennt für 15.5.29 und 16.4.5 keinen Treffer bei `next`. Weil 15.5.29 weiter `postcss` 8.4.31 festschreibt, wird `npm audit` erst mit 16.4.x vollständig sauber.
- **Empfehlung:**
  - Sofort auf `next` 15.5.29 heben und `sharp` ≥ 0.35.5, `nanoid` ≥ 3.3.18 sowie `source-map-js` ≥ 1.2.2 ziehen.
  - Das Upgrade auf 16.4.x als eigenes Requirement planen.
  - Tests mit `NODE_ENV=test` laufen lassen.
  - Den Patternschutz der Bild-API prüfen oder sie abschalten (`images.unoptimized`), falls sie nicht gebraucht wird. Im Code habe ich keine Nutzung geprüft.
- **Verifikation:** `npm audit`, Advisory-Abfrage und Erreichbarkeit live verifiziert. Ausnutzbarkeit nicht getestet, Upgrade nicht ausprobiert.

### 6. Kein HTTPS-Zwang und keine Security-Header (Schweregrad: mittel)

- **Befund:**
  - `http://dev.appbaua.com/login` und `http://app.appbaua.com/login` liefern 200 ohne Umleitung.
  - `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` und `Referrer-Policy` fehlen.
  - `X-Powered-By: Next.js` wird ausgeliefert.
  - `next.config.ts` setzt keine Header.
  - Zusätzlich ist die App über `${APP_PORT}:3000` auf allen Interfaces per HTTP erreichbar (`docker-compose.yml`, Service `app`).
- **Empfehlung:**
  - In Cloudflare „Always Use HTTPS“ und HSTS aktivieren.
  - Die Header in `next.config.ts` setzen und `poweredByHeader: false` eintragen.
  - Das Port-Mapping begrenzen, falls der direkte WLAN-Zugang nicht gebraucht wird.
- **Verifikation:** Header und Umleitung live verifiziert, Port-Mapping nur aus Config erschlossen.

### 7. Keine Backup- und Wiederherstellungsstrategie (Schweregrad: mittel)

- **Befund:** Im Repo gibt es kein Backup, kein Restore-Skript und keinen Restore-Nachweis. Das Volume `db-data` enthält Passkeys, Backup-Code-Hashes, Sessions, Repo-Konfiguration und Worker-Verlauf. Es gibt nur die Idee `delivery/idea/backup-mit-restore-drill-nachweis.md`.
- **Empfehlung:**
  - Regelmäßig einen verschlüsselten `pg_dump` an einen Ort außerhalb des Beelink schreiben.
  - Die Wiederherstellung testen und dokumentieren.
  - Die Backup-Erwartung über `setup-security` festhalten.
- **Verifikation:** nur aus Code/Config erschlossen. Ein Backup auf Host-Ebene konnte ich nicht ausschließen.

### 8. Anmeldung nach Passkey-Registrierung nutzt die ID aus dem Request (Schweregrad: mittel)

- **Befund:** `lib/auth-finish-registration.ts:26` sucht den Benutzer über `response.id` aus dem Request, nicht über die verifizierte Credential-ID. Die Bibliothek prüft nur `id === rawId`, nicht die Übereinstimmung mit der attestierten ID. Wer eine gültige Einladung hat und die Credential-ID eines anderen Nutzers kennt, kann sich als dieser anmelden, im schlimmsten Fall als Betreiber.
- **Empfehlung:** `finishRegistration` soll die `userId` der Zeremonie bzw. die verifizierte Credential-ID zurückgeben, und `signIn` soll nur damit arbeiten. Dazu ein Regressionstest.
- **Verifikation:** nur aus Code erschlossen, einschließlich des Bibliothekscodes.

### 9. Kein Rate-Limit auf den Auth-Routen (Schweregrad: niedrig)

- **Befund:** `/api/auth/recovery/start` und die weiteren Auth-Routen haben keine Bremse. `lib/rate-limit.ts` betrifft nur Claude-Limits. Backup-Codes haben 80 Bit Zufall, reines Raten ist also nicht realistisch. Es bleiben Lastspitzen und unnötige Challenge-Einträge.
- **Empfehlung:** Eine Cloudflare-Rate-Limiting-Regel für `/api/auth/*` einrichten.
- **Verifikation:** nur aus Code erschlossen.

### 10. Dependabot-Alerts sind abgeschaltet (Schweregrad: niedrig)

- **Befund:** Die GitHub-API meldet „Dependabot alerts are disabled for this repository“. Niemand wird bei neuen Advisories benachrichtigt. Branch Protection von `main`, Secret Scanning und Actions-Rechte konnte der Token nicht lesen (403), diese Punkte sind also ungeprüft.
- **Empfehlung:** Dependabot-Alerts einschalten. Branch Protection von `main` im GitHub-UI kontrollieren.
- **Verifikation:** live verifiziert.

### 11. `WATCHDOG_TOKEN` fehlt in der Redaction (Schweregrad: niedrig)

- **Befund:** `SECRET_ENV_VARS` in `lib/redact.ts:41` enthält `GITHUB_TOKEN`, `GH_TOKEN` und `TELEGRAM_BOT_TOKEN`, aber nicht `WATCHDOG_TOKEN`, und auch nicht `PGPASSWORD` oder `CLOUDFLARE_TUNNEL_TOKEN`. Taucht einer dieser Werte in einer Ausgabe auf, wird er nicht entfernt.
- **Empfehlung:** Die Liste erweitern und einen Test ergänzen.
- **Verifikation:** nur aus Code erschlossen.

### 12. `.gitignore` deckt env-Dateien nicht ab, Doku und Deploy weichen ab (Schweregrad: niedrig)

- **Befund:** `deploy/*.env` ist nicht ignoriert, obwohl `delivery/devops.md` und `docker-compose.yml` diesen Pfad nennen. Der Deploy liest tatsächlich `$HOME/appbaua-env/*.env` (`.github/workflows/deploy.yml`). Im Repo liegt keine solche Datei, das Risiko ist also klein. Eine dort abgelegte Datei würde aber mitcommittet, und das in einem öffentlichen Repo.
- **Empfehlung:** `deploy/*.env` in `.gitignore` aufnehmen und die Pfade in der Doku korrigieren.
- **Verifikation:** nur aus Code/Config erschlossen.

### 13. Container-Images nicht auf Versionen festgelegt (Schweregrad: niedrig)

- **Befund:** `cloudflare/cloudflared:latest` läuft ohne feste Version, und `node:22-alpine` und `postgres:17-alpine` sind wandernde Tags. Der Stand ist damit nicht nachvollziehbar, Updates kommen zufällig.
- **Empfehlung:** Versionen pinnen und bewusst aktualisieren, z. B. mit Renovate oder Dependabot.
- **Verifikation:** nur aus Code/Config erschlossen.

## Positiv

- **Secrets:** Im aktuellen Stand und in der Git-Historie fand die Suche nach bekannten Token-Formaten nur erkennbar ausgedachte Test-Fixtures. Versionierte env-Dateien gibt es außer `.env.example` keine.
- **Einladungen und Backup-Codes:** Beide Routen prüfen die Session echt über `currentUser()`. Ein erfundener Cookie dürfte dort also nicht reichen (nur aus Code erschlossen).
- **Bootstrap:** Er läuft nur bei leerer Benutzertabelle.
- **Session-Cookie:** `httpOnly`, `SameSite=Lax` und `Secure` in Produktion, die Token stammen aus sicherem Zufall.
- **Container:** App und Worker laufen ohne root, das Host-Wurzelverzeichnis ist nicht gemountet, der Agent veröffentlicht keinen Port.
- **Tunnel:** Er kommt ohne offenen Router-Port aus.
- **CI:** Der Deploy reagiert nur auf `push` und läuft deshalb nicht für Pull Requests aus Forks auf dem self-hosted Runner.
