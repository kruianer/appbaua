---
type: security
repo: AppBaua
commit: f8eaf0d
date: 2026-10-28
---

# Security: AppBaua (f8eaf0d)

Automatisch erstellt vom appbaua-Worker am 2026-10-28.

# Security-Bericht: appbaua (f8eaf0d)

**Hinweis:** Es gibt keine repo-spezifische `delivery/security.md`. Ich habe daher nach allgemeinen Best Practices geprüft und gegen das SOLL, das sich aus `CLAUDE.md` und `delivery/devops.md` ergibt. Laut diesen Dateien sind dev und prod bewusst über Cloudflare Tunnel öffentlich erreichbar, der Zugang ist per Passkey geschützt (req-023), und die Secrets liegen nur in `deploy/*.env` außerhalb des Repos.

## Kurz-Zusammenfassung

Der kritische Kernbefund der Vorberichte besteht seit Wochen fort. Ich habe ihn heute erneut live nachgewiesen, und er wiegt schwerer als bisher beschrieben:

- **Ein erfundener Session-Cookie genügt für vollen Zugriff auf dev und prod.** Auf beiden Hosts kamen Repo-Liste, Worker-Zustand und Lauf-Protokoll sowie das UI zurück.
- **Über denselben Weg ist der Chat erreichbar (req-040).** Er startet Claude Code mit `--dangerously-skip-permissions` im App-Container, und dort steht `GITHUB_TOKEN` in der Umgebung. Das öffnet faktisch eine **Codeausführung durch Unbekannte aus dem Internet**. Das habe ich nur aus dem Code erschlossen und bewusst nicht ausgelöst.

Weitere Befunde:
- 5 offene Advisories bei den Abhängigkeiten (1 kritisch, 4 hoch).
- HTTPS wird nicht erzwungen: `http://` liefert live `200`, ohne Umleitung. Security-Header fehlen.
- Es gibt keine Backup-Strategie.
- `deploy/*.env` ist nicht in `.gitignore`.

In der Git-Historie habe ich keine echten Secrets gefunden. Die Treffer sind erkennbar ausgedachte Test-Fixtures.

## Findings

### 1. Session-Cookie wird nur auf Vorhandensein geprüft, nicht auf Gültigkeit (Schweregrad: hoch, eigentlich kritisch)

- **Befund:** `middleware.ts` prüft nur, ob `appbaua_session` vorhanden und nicht leer ist. Der Kommentar dort verspricht eine zweite Prüfung, die gefälschte Cookies abweist („A stale/forged cookie value still gets bounced at that second check“). Diese Prüfung gibt es nicht. Eine Suche nach Session-Validierung (`getSession|requireSession|validSession|readSession|sessionFrom`) unter `app/api` ergab **keinen einzigen Treffer**.
- **Live verifiziert am 2026-10-28** gegen `dev.appbaua.com` und `app.appbaua.com`:
  - Ohne Cookie liefert `GET /api/repos` korrekt `401`.
  - Mit `Cookie: appbaua_session=fake` liefern `/api/repos`, `/api/worker-state` und `/api/run-log` jeweils `200` mit echten Daten. Auf prod waren das Repo-Liste, `enabled: true` und Lauf-Einträge von heute.
  - `/` liefert mit dem gefälschten Cookie die App-Oberfläche (`200`).
- **Auswirkung:** Jeder im Internet kann den Worker steuern, also an- und abschalten, Repos und Task-Typen ändern. Er kann Container über `/api/health/restart` und `/api/health/containers/restart` neu starten; dahinter steht der `health-agent` mit gemountetem `/var/run/docker.sock`. Und er kann den Chat bedienen (siehe Finding 2). Schreibende Endpunkte habe ich nicht live ausgelöst, das ist aus dem Code erschlossen.
- **Empfehlung:**
  - Sofort einen gemeinsamen Wrapper (`withSession(handler)`) bauen, der die Session gegen den Postgres-Store prüft. Ihn in jedem nicht-öffentlichen Route-Handler und in jeder Server-Komponente einsetzen.
  - Den irreführenden Kommentar in `middleware.ts` korrigieren.
  - Bis zur Korrektur Cloudflare Access (Zero Trust, nur die E-Mail des Betreibers) vor beide Hostnamen schalten. Das ist die schnellste Abhilfe ohne Code.
  - Dafür ein Requirement bzw. einen Bug mit höchster Priorität anlegen.
  - Nach dem Fix die Live-Prüfung mit gefälschtem Cookie auf dev wiederholen.

### 2. Chat führt Claude Code ohne Rückfragen im internetzugewandten Container aus (Schweregrad: hoch)

- **Befund:**
  - `POST /api/chat/[repoId]/messages` startet über `lib/chat-session-manager.ts` den Aufruf `runClaude()` aus `lib/claude-runner.ts`.
  - `runClaude()` ruft `claude -p <prompt> --dangerously-skip-permissions` auf (`lib/claude-runner.ts:579`).
  - Der `app`-Container erhält `GITHUB_TOKEN` über `docker-compose.yml` (Service `app`, Zeile 62) und hat eine beschreibbare Claude-Anmeldung (`claude-home`-Volume).
  - Zusammen mit Finding 1 kann ein Angreifer mit beliebigem Cookie Prompts absetzen. Claude führt dann ohne Rückfrage Shell-Befehle aus, kann also z. B. den GitHub-Token und das OAuth-Token auslesen oder Code in Repos pushen.
- **Verifikation:** nur aus Code/Config erschlossen. Ich habe es bewusst nicht live ausgelöst, weil der Aufruf schädliche Nebenwirkungen hätte.
- **Empfehlung:**
  - Zuerst Finding 1 beheben.
  - Danach den `GITHUB_TOKEN` aus der Umgebung des Chat-Prozesses entfernen und einen fein begrenzten Token verwenden.
  - Prüfen, ob der Chat in einem eigenen Container mit minimalen Rechten laufen kann.

### 3. Abhängigkeiten mit bekannten Lücken (Schweregrad: hoch)

- **Befund:** `npm audit --omit=dev` meldet heute 5 Advisories (1 kritisch, 4 hoch):
  - `next` 9.3.4-canary.0 bis 16.3.0-preview.10 (kritisch)
  - `nanoid` < 3.3.18 (Endlosschleife)
  - `postcss` ≤ 8.5.22
  - `sharp` ≤ 0.35.5-rc.1 (libvips, libheif, librsvg)
  - `source-map-js` 1.0.0 bis 1.2.1 (DoS)
- **Empfehlung:** `next` auf ≥ 16.4.0 heben und `npm update nanoid source-map-js postcss sharp` ausführen. Laut Vorbericht ist `npm audit fix` allein wirkungslos. Danach Tests (mit `NODE_ENV=test`) und `npm audit` erneut laufen lassen. Das Upgrade per Requirement umsetzen.
- **Verifikation:** `npm audit` habe ich heute live ausgeführt. Ob der Upgrade-Weg wirkt, habe ich nicht erneut geprüft.

### 4. Kein HTTPS-Zwang und keine Security-Header (Schweregrad: mittel)

- **Befund, live verifiziert:**
  - `http://dev.appbaua.com/login` und `http://app.appbaua.com/login` antworten mit `200`, ohne Umleitung auf HTTPS. „Always Use HTTPS“ ist in Cloudflare also nicht aktiv.
  - Die HTTPS-Antworten enthalten weder `Strict-Transport-Security` noch `Content-Security-Policy`, `X-Frame-Options` oder `X-Content-Type-Options`.
  - `next.config.ts` setzt keine Header.
  - Im WLAN ist die App zusätzlich direkt über HTTP erreichbar, über `ports: "${APP_PORT}:3000"` auf allen Interfaces.
- **Empfehlung:**
  - In Cloudflare „Always Use HTTPS“ und HSTS aktivieren.
  - In `next.config.ts` per `headers()` HSTS, CSP, `X-Frame-Options: DENY` und `X-Content-Type-Options: nosniff` setzen.
  - Den Port-Mapping-Eintrag auf die LAN-IP bzw. `127.0.0.1` begrenzen, falls der direkte WLAN-Zugang nicht gebraucht wird.

### 5. Keine Backup- und Wiederherstellungsstrategie (Schweregrad: mittel)

- **Befund:** Das Repo enthält kein Backup, kein Restore-Skript und keinen Restore-Nachweis. Es gibt nur die offene Idee `delivery/idea/backup-mit-restore-drill-nachweis.md`. Das Volume `db-data` (Postgres) ist nicht gesichert. Darin liegen Passkeys, Backup-Codes, Sessions, Repo-Konfiguration und Worker-Verlauf.
- **Empfehlung:**
  - Einen regelmäßigen, verschlüsselten `pg_dump` an einen Ort außerhalb des Beelink einrichten.
  - Die Wiederherstellung einmal testen und das Ergebnis dokumentieren.
  - Die Backup-Erwartung per `setup-security` festhalten.
- **Verifikation:** nur aus Code/Config erschlossen. Die Infrastruktur habe ich nicht geprüft, weil kein SSH-Zugang hinterlegt ist.

### 6. `deploy/*.env` ist nicht in `.gitignore` (Schweregrad: niedrig)

- **Befund:** `.gitignore` deckt nur `.env` und `.env*.local` ab. Die in `devops.md` genannten Dateien `deploy/dev.env` und `deploy/prod.env` sind nicht ignoriert (Mustervergleich). Darin stehen Tunnel-Token, Telegram-Token, `GITHUB_TOKEN` und das DB-Passwort. Der Worker committet mit `git add -A`, eine dort abgelegte Datei würde also mitgepusht.
- **Empfehlung:** `deploy/*.env` und `*.env` (mit Ausnahme `!.env.example`) in `.gitignore` aufnehmen.
- **Verifikation:** nur aus Code/Config erschlossen.

### 7. `cloudflared:latest` ohne feste Version (Schweregrad: niedrig)

- **Befund:** `docker-compose.yml` verwendet `cloudflare/cloudflared:latest` mit `--no-autoupdate`. Welche Version läuft, ist damit weder nachvollziehbar noch reproduzierbar. Sicherheitsupdates kommen nur zufällig bei einem neuen Pull an.
- **Empfehlung:** Auf eine konkrete Version pinnen und bewusst aktualisieren, z. B. per Renovate oder Dependabot.
- **Verifikation:** nur aus Code/Config erschlossen.

## Positiv

- Ohne Cookie antworten API und Seiten korrekt mit `401` bzw. leiten auf `/login` um (live).
- In der Git-Historie fand ich keine echten Secrets. Die Treffer der Suche nach `ghp_`, `github_pat_`, `sk-ant-`, `AKIA` und Private Keys sind erkennbar ausgedachte Test-Fixtures.
- Das Host-Wurzelverzeichnis ist nicht mehr in den App-Container gemountet (bug-005), nur `/proc` lesend.
- Der Tunnel kommt ohne offenen Router-Port aus. Die Tunnel-Token stehen nur in der env-Datei.
