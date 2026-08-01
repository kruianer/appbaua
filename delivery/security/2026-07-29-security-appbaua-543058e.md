---
type: security
repo: AppBaua
commit: 543058e
date: 2026-07-29
---

# Security: AppBaua (543058e)

Automatisch erstellt vom appbaua-Worker am 2026-07-29.

Clean — no changes to the repo. Now compiling the final report.

Findings confirmed via a mix of live HTTPS/HTTP checks against dev/prod, `npm audit`, and code review of auth, cookie, logging, and config code. No `delivery/security.md` exists in this repo, so I checked against `delivery/devops.md`/`delivery/stack.md` (which do state HTTPS-Pflicht and the access model) plus general best practice for everything else.

# Security-Check appbaua — 2026-07-29

**Kurz-Zusammenfassung:** Keine repo-spezifische `delivery/security.md` vorhanden — geprüft gegen die HTTPS-/Zugriffsvorgaben aus `delivery/devops.md`/`delivery/stack.md` sowie allgemeine Best Practices. Auth (Passkey/WebAuthn, Session-Cookies, Credential-Redaction in Logs) ist solide umgesetzt, keine Secrets im Repo/in der Git-Historie. Zwei Findings: HTTPS wird am Cloudflare-Edge nicht erzwungen (Klartext-HTTP wird bedient), und drei bekannte High-Severity-Lücken in transitiv von Next.js gebündelten Paketen (postcss, sharp) ohne im Projekt nutzbaren Angriffspfad. Zu Backup & Wiederherstellung fehlt jede dokumentierte Erwartung.

## 1. HTTPS wird am Edge nicht erzwungen (mittel)

`delivery/stack.md` verlangt: "jede über das Netz erreichbare Umgebung … muss ein gültiges TLS-Zertifikat haben." Live-Test gegen beide Domains zeigt, dass Cloudflare Klartext-HTTP-Anfragen nicht auf HTTPS umleitet, sondern durchreicht — die App antwortet dann direkt (mit `307` zu `/login`) über die unverschlüsselte Verbindung:

```
http://dev.appbaua.com  → 307 /login  (cf-ray vorhanden, unverschlüsselt bedient)
http://app.appbaua.com  → 307 /login  (gleiches Verhalten)
```

Es fehlt außerdem ein `Strict-Transport-Security`-Header auf der HTTPS-Antwort. Das Session-Cookie ist zwar `Secure`-geflaggt (`lib/auth-cookie-name.ts`) und würde über HTTP nie gesendet, und WebAuthn-Ceremonies scheitern ohnehin außerhalb eines "secure context" — der eigentliche Login-Weg ist also nicht gefährdet. Trotzdem widerspricht es der expliziten Vorgabe, und ohne HSTS bleibt ein Downgrade-/Zwischenseiten-Fenster offen (z. B. jemand tippt `http://` oder folgt einem alten Link).

**Empfehlung:** In Cloudflare "Always Use HTTPS" (bzw. eine entsprechende Redirect-/Transform-Regel) für beide Zonen aktivieren, sodass Port 80 grundsätzlich auf `https://` umleitet statt die App zu erreichen; zusätzlich `Strict-Transport-Security` als Response-Header setzen (z. B. via `next.config.ts` `headers()` oder Cloudflare-seitig).

**Verifikation:** live (HTTP-Requests direkt gegen dev.appbaua.com und app.appbaua.com gestellt).

## 2. Bekannte High-Severity-Lücken in von Next.js gebündelten Paketen (niedrig)

`npm audit` meldet 3 High-Severity-Advisories für `postcss` (≤8.5.17: XSS via CSS-Stringify, Path-Traversal/Info-Disclosure über `sourceMappingURL`) und `sharp` (<0.35.0: von libvips geerbte CVEs). Beide sind keine direkten Projekt-Dependencies, sondern von `next@15.5.21` selbst mitgebracht — auch die neueste 15.x-Version (`15.5.22`) pinnt weiterhin `postcss@8.4.31`. `npm audit fix --force` würde auf `next@9.3.3` **herunter**stufen, was keine echte Lösung ist.

Praktischer Angriffspfad im Projekt fehlt: `next/image`/`sharp` wird im Code nicht verwendet (kein Treffer für `next/image` in `app/`/`components/`), und `postcss` verarbeitet zur Laufzeit keine von außen kommende, nicht vertrauenswürdige CSS-Eingabe — es ist ein Build-Time-Tool.

**Empfehlung:** Kein sofortiger Handlungsbedarf, aber im Auge behalten: bei nächster Next.js-Major-/Minor-Version mit gepatchtem `postcss`/`sharp` zeitnah aktualisieren (`npm outdated next` zeigt aktuell `15.5.22` als "wanted", `16.2.12` als "latest" — Major-Sprung, separat zu bewerten). Sollte `next/image` künftig eingeführt werden, vorher erneut prüfen.

**Verifikation:** live (`npm audit` gegen die tatsächlich installierte `package-lock.json` gelaufen) + Code-Grep für `next/image`-Nutzung.

## 3. Keine dokumentierte Backup-Erwartung für die Postgres-Daten (niedrig)

Weder `delivery/security.md` (fehlt) noch `delivery/devops.md` benennen eine Backup-/Wiederherstellungs-Strategie für die Produktivdaten. Die "Backup-Codes" in `devops.md` betreffen nur Auth-Recovery (Passkey-Ersatz), nicht die Daten selbst. Postgres läuft im Docker-Volume `db-data` ohne erkennbaren automatisierten Dump/Snapshot-Mechanismus im Repo. Bei Verlust/Defekt des Beelink-Datenträgers wären Repo-Konfiguration, Requirements-Verlauf, Worker-Historie und Auth-Zustand ersatzlos weg.

**Empfehlung:** Backup-Erwartung explizit festlegen (z. B. via Skill `setup-security`) und einen einfachen periodischen `pg_dump` des `db-data`-Volumes auf ein zweites Medium einrichten — Umfang/Frequenz hängt davon ab, wie kritisch der Worker-Verlauf für den Nutzer ist.

**Verifikation:** aus Code/Config erschlossen (kein Backup-Skript/-Workflow im Repo, keine Vorgabe in `devops.md`).

---

Nicht prüfbar aus dieser Umgebung: Cloudflare-Dashboard-Konfiguration (Tunnel-/DNS-/TLS-Einstellungen direkt), GitHub-Branch-Protection auf `main`, und die WLAN-interne Erreichbarkeit `192.168.2.200:8090` (kein Netzwerkzugriff auf das interne Netz von hier aus) — `delivery/deploy-setup.md` beschreibt diesen Weg noch als "Phase 1 (WLAN, kein HTTPS)", was mittlerweile durch die in `devops.md` dokumentierte Cloudflare-Tunnel-Lösung (req-024, bereits umgesetzt) überholt ist; die Datei selbst wurde nicht geändert, da dies eine reine Prüfung ist.
