---
type: security
repo: AppBaua
commit: 33f2f39
date: 2026-10-21
---

# Security: AppBaua (33f2f39)

Automatisch erstellt vom appbaua-Worker am 2026-10-21.

# Security-Bericht: appbaua (33f2f39)

**Hinweis:** Es lag keine repo-spezifische `delivery/security.md` vor. Geprüft wurde nach allgemeinen Best Practices und gegen das SOLL, das sich aus `CLAUDE.md` und `delivery/devops.md` ableiten lässt. Dieses SOLL ist: dev und prod bewusst öffentlich über Cloudflare Tunnel, Zugangsschutz per Passkey (req-023).

## Kurz-Zusammenfassung

Der Kernbefund der Vorberichte besteht unverändert fort: **ein frei erfundener Session-Cookie genügt für vollen Zugriff.** Ich habe das heute live nachgewiesen. Dazu kommen 5 offene Advisories bei den Abhängigkeiten (1 kritisch, 4 hoch), kein HTTPS-Zwang bzw. keine Security-Header und keine Backup-Strategie. In den geprüften Dateien habe ich keine Secrets gefunden. Das Git-Log habe ich nur auf die Commit-Titel hin angesehen. Eine Suche nach Secrets in der Git-Historie habe ich heute nicht gemacht.

## Findings

### 1. Session-Cookie wird nur auf Vorhandensein geprüft, nicht auf Gültigkeit (Schweregrad: hoch)

- **Befund:** `middleware.ts` prüft nur, ob ein Cookie namens `appbaua_session` existiert und nicht leer ist. Der Kommentar dort verweist auf eine "echte Prüfung" in den API-Routen. Diese fehlt aber fast überall. Die Suche nach `getSession`, `requireSession` und `verifySession` fand in 40 der `app/api/**/route.ts` keinen Treffer. Darunter sind auch nicht-öffentliche Routen wie `/api/repos/*`, `/api/chat/*`, `/api/health/restart`, `/api/health/containers/restart`, `/api/worker-state`, `/api/run-log`, `/api/github-repos`, `/api/task-types/*` und `/api/health/settings`. Die Treffer sind eine reine Textsuche ohne Handler-Prüfung. Einige dieser Routen könnten die Session über einen Helfer mit anderem Namen prüfen. Der Live-Test spricht aber dagegen, zumindest für `/api/repos`.
- **Live verifiziert:**
  - `GET /api/repos` ohne Cookie liefert auf `dev.appbaua.com` und `app.appbaua.com` jeweils `401`.
  - Mit `Cookie: appbaua_session=fake` liefert derselbe Aufruf auf beiden Hosts `200` mit der Repo-Liste.
- **Auswirkung:** Jeder Angreifer von außen kann Worker-Steuerung, Chat, Container-Neustarts und Repo-Daten bedienen. Weitere Routen als `/api/repos` habe ich nicht getestet.
- **Empfehlung:**
  - Die Session in jedem nicht-öffentlichen Route-Handler und jeder Server-Komponente serverseitig gegen den Store validieren. Ein gemeinsamer Wrapper wie `withSession(handler)` eignet sich dafür.
  - Nach der Korrektur dieselbe Live-Prüfung mit gefälschtem Cookie auf dev wiederholen.
  - Dafür gibt es noch kein Requirement. Es sollte eines angelegt werden. Das ist die dringendste Maßnahme.

### 2. Abhängigkeiten mit bekannten Lücken (Schweregrad: hoch)

- **Befund:** `npm audit --omit=dev` meldet 5 Advisories (1 kritisch, 4 hoch):
  - `next` (die Details habe ich heute nicht weiter ausgelesen)
  - `postcss` ≤ 8.5.22 (XSS, Source-Map-Dateilesen)
  - `sharp` ≤ 0.35.5-rc.1 (libvips, libheif, librsvg)
  - `source-map-js` (DoS)
- **Hinweis aus dem Vorbericht:** `npm audit fix` ist wirkungslos. Der wirksame Weg war laut Vorbericht ein Upgrade auf `next@16.4.0` plus `npm update nanoid source-map-js`, danach 0 Advisories. Das habe ich heute nicht erneut verifiziert.
- **Empfehlung:** Dieses Upgrade per Requirement umsetzen und die Tests laufen lassen.
- **Verifikation:** `npm audit` heute live gelaufen, die Wirksamkeit des Upgrade-Wegs ist nur aus dem Vorbericht übernommen.

### 3. Kein HTTPS-Zwang und keine Security-Header im Code (Schweregrad: mittel)

- **Befund:** Die Cookie-Option `secure` hängt an `NODE_ENV === "production"`. Ein HSTS-Header oder ein Redirect auf HTTPS in der App ist nicht belegt, ebenso wenig CSP oder `X-Frame-Options`. Das Cookie ist damit nur in der Produktion auf HTTPS beschränkt. Im WLAN-Zugang über `APP_PORT` läuft die App über HTTP.
- **Empfehlung:**
  - Security-Header in `next.config.ts` setzen.
  - HTTPS in Cloudflare erzwingen ("Always Use HTTPS").
  - Den Direktzugang über `APP_PORT` auf das lokale Netz beschränken.
- **Verifikation:** nur aus Code/Config erschlossen.

### 4. Keine Backup- und Wiederherstellungsstrategie (Schweregrad: mittel)

- **Befund:** Das Repo enthält kein Backup, kein Restore-Skript und keinen Restore-Nachweis. Es gibt nur eine offene Idee dazu (`delivery/idea/backup-mit-restore-drill-nachweis.md`). Der Postgres-Store enthält Passkeys, Sessions und Worker-Zustand und ist damit nicht gesichert.
- **Empfehlung:** Einen regelmäßigen `pg_dump` an einen externen Ort einrichten. Backup-Codes und Passkey-Daten sollten dabei verschlüsselt abgelegt werden. Außerdem eine Wiederherstellung testen.
- **Verifikation:** nur aus Code/Config erschlossen. Die Infrastruktur habe ich nicht geprüft.

### 5. `deploy/*.env` ist nicht in `.gitignore` (Schweregrad: niedrig)

- **Befund:** `git check-ignore deploy/x.env` liefert Exit-Code 1, die Datei wäre also nicht ignoriert. Aktuell sind keine solchen Dateien eingecheckt. Der Worker committet mit `git add -A`, daher könnte eine künftig abgelegte env-Datei versehentlich im Repo landen.
- **Empfehlung:** `deploy/*.env` und `.env*` (außer `.env.example`) in `.gitignore` aufnehmen.
- **Verifikation:** nur aus Code/Config erschlossen.

## Positiv

- In den Dateien, die ich eingesehen habe (`.env.example` u. a.), sind keine Secrets hinterlegt.
- Ohne Cookie antworten API und Seiten korrekt mit `401` bzw. Redirect auf `/login`.
