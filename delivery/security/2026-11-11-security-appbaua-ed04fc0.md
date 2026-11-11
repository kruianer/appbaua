---
type: security
repo: AppBaua
commit: ed04fc0
date: 2026-11-11
---

# Security: AppBaua (ed04fc0)

Automatisch erstellt vom appbaua-Worker am 2026-11-11.

# Security-Bericht: appbaua (ed04fc0)

**Hinweis:** Eine repo-spezifische `delivery/security.md` gibt es nicht. Geprüft habe ich deshalb nach allgemeinen Best Practices. Als SOLL dienen zusätzlich `CLAUDE.md` und `delivery/devops.md`: dev und prod sind bewusst öffentlich über den Cloudflare-Tunnel erreichbar, die Anmeldung läuft per Passkey (req-023), und Secrets liegen nur außerhalb des Repos.

## Kurz-Zusammenfassung

**Nichts hat sich verbessert: Mit einem erfundenen Session-Cookie kommt man weiterhin ohne Anmeldung in dev und prod. Das habe ich heute erneut live nachgewiesen.**

- **Keine Code-Änderung seit dem letzten Bericht:** Seit dem Bericht vom 04.11. (`599bcb2`) kamen nur Doku-Commits dazu (eine Idee, ein Code-Review, der Bericht selbst). An Code, Config und Abhängigkeiten hat sich nichts geändert. Der letzte Code-Commit ist `ecd6289` vom 21.10.
- **Für keines der Findings ist Abhilfe eingeplant:** `delivery/bugs/ready/` und `delivery/requirements/ready/` sind leer. Die Zugriffslücke stand schon in mehreren früheren Berichten. Sie bleibt offen, weil daraus nie ein Bug oder Requirement geworden ist.
- **Das Repo ist weiterhin öffentlich:** Die GitHub-API liefert anonym `private=false`. Auch dieser Bericht wird damit öffentlich abrufbar, zusammen mit einer genauen Anleitung, wie man die Anmeldung umgeht.
- **Abhängigkeiten unverändert verwundbar:** `next` 15.5.21 hat 1 kritisches und 4 hohe Advisories. Das Update auf 15.5.29 ist verfügbar und liegt innerhalb des bestehenden Versionsbereichs.

**Empfehlung an den Betreiber, in dieser Reihenfolge und ohne Code möglich:**
1. Repo auf privat stellen.
2. Cloudflare Access (nur die E-Mail des Betreibers) vor `dev.appbaua.com` und `app.appbaua.com` schalten.
3. Finding 1 über den Skill `capture-bug` als Bug anlegen. Dann setzt der Worker die Behebung um, statt sie nur jede Woche neu zu melden.

**Grenzen der Prüfung:**
- Kein SSH-Zugang hinterlegt. `curl`, `gh`, Docker und `cloudflared` gibt es in dieser Umgebung nicht. Live-Prüfungen liefen deshalb über `fetch` in Node.
- Live habe ich nur lesende GET-Anfragen geschickt und davon nur Statuscodes und Header ausgewertet, keine Inhalte.
- Schreibende Endpunkte, Chat, Agent und Datenbank habe ich nicht angefasst.
- Die GitHub-Einstellungen (Dependabot, Branch Protection) konnte ich ohne `gh` nicht erneut abfragen.

## Findings

### 1. Session-Cookie wird nicht auf Gültigkeit geprüft (Schweregrad: hoch)

- **Befund:** `middleware.ts:38` prüft nur, ob der Cookie `appbaua_session` vorhanden ist, nicht ob er gültig ist. Fach-APIs und App-Seiten prüfen die Session danach nicht noch einmal. Echt geprüft wird nur in einzelnen `/api/auth`-Routen über `currentUser()`.
- **Live verifiziert am 2026-11-11:**

| Anfrage | dev ohne Cookie | dev erfundener Cookie | prod ohne Cookie | prod erfundener Cookie |
|---|---|---|---|---|
| `/api/repos` | 401 | **200** | 401 | **200** |
| `/api/worker-state` | 401 | **200** | 401 | **200** |
| `/api/run-log` | 401 | **200** | 401 | **200** |
| `/` | 307 | **200** | 307 | **200** |

- **Auswirkung:** Jeder im Internet kann alle Daten lesen. Laut Code kann er außerdem Worker, Repos und Task-Typen steuern, Container neu starten und den Chat bedienen.
- **Empfehlung:**
  - Sofort Cloudflare Access davorschalten.
  - Einen gemeinsamen Wrapper bauen, der `currentUser()` in jedem nicht-öffentlichen Route-Handler und im App-Layout erzwingt.
  - Einen Test ergänzen, der jede Route unter `app/api` mit gefälschtem Cookie aufruft und 401 erwartet.
  - Als Bug mit höchster Priorität anlegen.

### 2. Chat führt Claude Code ohne Rückfrage im internetzugewandten Container aus (Schweregrad: hoch)

- **Befund:** Die Chat-Route startet Claude mit `--dangerously-skip-permissions` (`lib/claude-runner.ts`). Im selben Container liegen `GITHUB_TOKEN` und die schreibbare Claude-Anmeldung.
- **Auswirkung:** Zusammen mit Finding 1 kann ein Unbekannter Code ausführen, die Tokens stehlen und in die Repos pushen.
- **Empfehlung:**
  - Zuerst Finding 1 beheben.
  - Den Chat isolieren: eigener Container ohne Netzweg zum Agenten.
  - Einen Token nutzen, der auf die nötigen Repos begrenzt ist.
- **Verifikation:** nur aus Code/Config erschlossen, bewusst nicht ausgelöst.

### 3. Health-Agent ohne Authentifizierung und ohne Container-Allowlist (Schweregrad: hoch)

- **Befund:**
  - `agent/index.ts` kennt keine Authentifizierung. Einzige Grenze ist das Compose-Netz.
  - `env`, `logs` und `restart` wirken auf jeden Container des Hosts (`lib/docker.ts`).
  - `isAllowedCommand` prüft nur das Programm, nicht die Argumente. Damit ist `psql` mit beliebigen Argumenten möglich.
- **Auswirkung:** Über Finding 1 und 2 wären Secrets und Datenbanken aller Apps auf dem Beelink erreichbar, nicht nur appbaua.
- **Empfehlung:**
  - Den Agenten mit einem gemeinsamen Geheimnis absichern.
  - Eine Allowlist der überwachten Container einführen.
  - `env` auf benötigte Variablennamen begrenzen.
  - `exec` auf feste Befehle ohne freie Argumente beschränken.
- **Verifikation:** nur aus Code erschlossen, nicht ausgelöst.

### 4. Öffentliches Repo enthält ausnutzbare Schwachstellenberichte (Schweregrad: hoch)

- **Befund:** `kruianer/appbaua` ist öffentlich. Unter `delivery/security/` liegen öffentlich Berichte mit genauer Anleitung, wie man die Anmeldung umgeht. Unter `delivery/` stehen außerdem Betriebsdetails: die LAN-IP und der SSH-Benutzer des Beelink (`delivery/ssh-tunnel-anleitung.md`) und die E-Mail des Betreibers.
- **Live verifiziert am 2026-11-11:** Die GitHub-API liefert anonym HTTP 200 mit `private=false`.
- **Empfehlung:**
  - Das Repo auf privat stellen und danach den self-hosted Runner prüfen.
  - Alle bisherigen Berichte als öffentlich bekannt behandeln.
  - Auf Spuren von Missbrauch prüfen: unbekannte Repos, Chat-Verläufe, Commits, Container-Neustarts.
  - Nach Behebung von Finding 1 `GITHUB_TOKEN`, Claude-Anmeldung und `TELEGRAM_BOT_TOKEN` rotieren.

### 5. Abhängigkeiten mit bekannten Lücken (Schweregrad: hoch)

- **Befund:** `npm audit --omit=dev` meldet am 2026-11-11 5 Advisories (1 kritisch, 4 hoch). Der Stand ist unverändert zum Vorbericht.

| Paket | installiert | Kernproblem |
|---|---|---|
| `next` | 15.5.21 | kritisch: Codeausführung in der Bild-API ohne Anmeldung, Cache Poisoning, DoS |
| `sharp` | 0.34.5 | Lücken aus libvips, libheif und librsvg |
| `postcss` | 8.4.31 | Dateizugriff über `sourceMappingURL` |
| `nanoid` | 3.3.16 | Endlosschleife |
| `source-map-js` | 1.2.1 | DoS |

- **Bild-API:** `/_next/image` ist aus der Middleware ausgenommen (`middleware.ts:55`) und deshalb ohne Cookie erreichbar.
- **Empfehlung:**
  - Sofort `next` auf 15.5.29 heben (laut npm verfügbar).
  - `sharp` ≥ 0.35.5, `nanoid` ≥ 3.3.18 und `source-map-js` ≥ 1.2.2 ziehen.
  - Das Upgrade auf 16.4.x als eigenes Requirement planen.
  - Die Bild-API abschalten (`images.unoptimized`), falls sie nicht gebraucht wird.
  - Tests mit `NODE_ENV=test` laufen lassen.
- **Verifikation:** `npm audit` und die verfügbare Version live verifiziert. Ausnutzbarkeit nicht getestet.

### 6. Kein HTTPS-Zwang und keine Security-Header (Schweregrad: mittel)

- **Befund:**
  - `http://dev.appbaua.com/login` und `http://app.appbaua.com/login` liefern 200 ohne Umleitung auf HTTPS.
  - `Strict-Transport-Security`, `Content-Security-Policy` und `X-Frame-Options` fehlen.
  - Der Header `X-Powered-By: Next.js` wird ausgeliefert.
  - Zusätzlich ist die App über `${APP_PORT}:3000` auf allen Interfaces per HTTP erreichbar (`docker-compose.yml`).
- **Empfehlung:**
  - In Cloudflare „Always Use HTTPS“ und HSTS aktivieren.
  - Die Header in `next.config.ts` setzen und `poweredByHeader: false` eintragen.
  - Das Port-Mapping auf `127.0.0.1` begrenzen, falls der direkte WLAN-Zugang nicht gebraucht wird.
- **Verifikation:** Umleitung und Header live verifiziert am 2026-11-11, Port-Mapping nur aus Config erschlossen.

### 7. Keine Backup- und Wiederherstellungsstrategie (Schweregrad: mittel)

- **Befund:** Im Repo gibt es weder Backup noch Restore-Skript noch einen Restore-Nachweis. Das Volume `db-data` enthält Passkeys, Backup-Code-Hashes, Sessions, Repo-Konfiguration und Worker-Verlauf. Es gibt nur die Idee `delivery/idea/backup-mit-restore-drill-nachweis.md`.
- **Empfehlung:**
  - Regelmäßig einen verschlüsselten `pg_dump` an einen Ort außerhalb des Beelink schreiben.
  - Die Wiederherstellung testen.
  - Die Backup-Erwartung über `setup-security` festhalten.
- **Verifikation:** nur aus Code/Config erschlossen. Ein Backup auf Host-Ebene kann ich nicht ausschließen.

### 8. Anmeldung nach Passkey-Registrierung nutzt die ID aus dem Request (Schweregrad: mittel)

- **Befund:** `lib/auth-finish-registration.ts:26` sucht den Benutzer über `response.id` aus dem Request, nicht über die verifizierte Credential-ID. Wer eine gültige Einladung hat und die Credential-ID eines anderen Nutzers kennt, kann sich als dieser anmelden.
- **Empfehlung:** `signIn` soll nur mit der verifizierten Credential-ID bzw. der `userId` der Zeremonie arbeiten. Dazu einen Regressionstest ergänzen.
- **Verifikation:** nur aus Code erschlossen.

### 9. Kein Rate-Limit auf den Auth-Routen (Schweregrad: niedrig)

- **Befund:** `/api/auth/*` hat keine Bremse. Reines Raten der Backup-Codes ist nicht realistisch, sie haben 80 Bit Zufall. Es bleiben Lastspitzen und unnötige Challenge-Einträge.
- **Empfehlung:** Eine Cloudflare-Rate-Limiting-Regel für `/api/auth/*` einrichten.
- **Verifikation:** nur aus Code erschlossen.

### 10. Dependabot-Alerts abgeschaltet (Schweregrad: niedrig)

- **Befund:** Am 04.11. waren die Dependabot-Alerts laut GitHub-API abgeschaltet. Heute konnte ich das nicht erneut prüfen, weil `gh` fehlt.
- **Empfehlung:** Dependabot-Alerts einschalten und die Branch Protection von `main` kontrollieren.
- **Verifikation:** am 04.11. live verifiziert, heute nicht erneut geprüft.

### 11. Redaction unvollständig (Schweregrad: niedrig)

- **Befund:** `SECRET_ENV_VARS` in `lib/redact.ts` enthält weder `WATCHDOG_TOKEN` noch `PGPASSWORD` noch `CLOUDFLARE_TUNNEL_TOKEN`. Taucht einer dieser Werte in einer Ausgabe auf, wird er nicht entfernt.
- **Empfehlung:** Die Liste erweitern und einen Test ergänzen.
- **Verifikation:** nur aus Code erschlossen.

### 12. `.gitignore` deckt `deploy/*.env` nicht ab (Schweregrad: niedrig)

- **Befund:** `deploy/*.env` ist nicht ignoriert, obwohl Doku und Compose diesen Pfad nennen. Der Deploy liest tatsächlich `$HOME/appbaua-env/*.env`. Eine dort im Repo abgelegte Datei würde mitcommittet, und das Repo ist öffentlich.
- **Empfehlung:** `deploy/*.env` in `.gitignore` aufnehmen und die Pfade in der Doku angleichen.
- **Verifikation:** nur aus Code/Config erschlossen.

### 13. Container-Images nicht auf Versionen festgelegt (Schweregrad: niedrig)

- **Befund:** `cloudflare/cloudflared:latest`, `node:22-alpine` und `postgres:17-alpine` sind wandernde Tags. Damit ist nicht nachvollziehbar, welche Version gerade läuft.
- **Empfehlung:** Versionen pinnen und bewusst aktualisieren, z. B. mit Renovate oder Dependabot.
- **Verifikation:** nur aus Code/Config erschlossen.

## Positiv (unverändert)

- **Secrets:** Im Repo liegen keine echten Secrets. Versionierte env-Dateien gibt es außer `.env.example` keine.
- **Session-Cookie:** `httpOnly`, `SameSite=Lax` und `Secure` in Produktion, die Token stammen aus sicherem Zufall.
- **Container:** App und Worker laufen ohne root, der Agent veröffentlicht keinen Port.
- **Tunnel:** Er kommt ohne offenen Router-Port aus.
- **CI:** Der Deploy läuft nur bei `push`, nicht für Pull Requests aus Forks.
