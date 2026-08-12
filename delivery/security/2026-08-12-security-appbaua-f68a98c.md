---
type: security
repo: AppBaua
commit: f68a98c
date: 2026-08-12
---

# Security: AppBaua (f68a98c)

Automatisch erstellt vom appbaua-Worker am 2026-08-12.

Now I have everything needed. Writing the final report.

---
type: security
repo: AppBaua
commit: f68a98c
date: 2026-08-12
---

# Security: AppBaua (f68a98c)

**Kurz-Zusammenfassung:** Keine repo-spezifische `delivery/security.md` vorhanden — geprüft gegen die HTTPS-/Zugriffsvorgaben aus `delivery/devops.md`/`delivery/stack.md` sowie allgemeine Best Practices. Seit dem letzten Security-Check (2026-08-05, Commit `befcdb2`) gab es **keine einzige Code-/Config-Änderung** in einem der vier Prüfbereiche — die beiden Commits seither legen nur den letzten Security- bzw. Code-Review-Bericht ab. Entsprechend bestehen die drei damaligen Findings unverändert fort; ein vierter, eng verwandter Befund (`nanoid`) kommt im Dependency-Audit neu hinzu. Auth (Passkey/WebAuthn, invite-only Registrierung, opake Session-Token mit `httpOnly`/`secure`/`sameSite=lax`, SHA-256-gehashte Backup-Codes mit 80 Bit Entropie, Credential-Redaction in Logs) bleibt solide; keine Secrets im Repo oder in der Git-Historie (der einzige Treffer für ein `ghp_`-Muster ist ein offensichtlich synthetischer Test-Fixture-Token in `lib/appbaua-standard.test.ts`, der gerade die Redaction-Logik prüft).

## 1. HTTPS wird am Edge weiterhin nicht erzwungen (mittel)

`delivery/stack.md` verlangt: "jede über das Netz erreichbare Umgebung … muss ein gültiges TLS-Zertifikat haben." Live-Test heute gegen beide Domains zeigt unverändert, dass Cloudflare Klartext-HTTP nicht auf HTTPS umleitet, sondern durchreicht:

```
http://dev.appbaua.com  → 307 /login  (unverschlüsselt bedient)
http://app.appbaua.com  → 307 /login  (unverschlüsselt bedient)
```

Auf der HTTPS-Antwort fehlt weiterhin der `Strict-Transport-Security`-Header (auf beiden Domains geprüft). Das Session-Cookie ist `Secure`-geflaggt und WebAuthn scheitert außerhalb eines "secure context" ohnehin — der Login-Weg selbst ist nicht gefährdet, aber die explizite Vorgabe bleibt verletzt, und ohne HSTS bleibt das Downgrade-Fenster offen.

**Empfehlung:** unverändert — in Cloudflare "Always Use HTTPS" für beide Zonen aktivieren und `Strict-Transport-Security` als Response-Header setzen (z. B. via `next.config.ts` `headers()`).

**Verifikation:** live (HTTP/HTTPS-Requests heute direkt gegen dev.appbaua.com und app.appbaua.com gestellt).

## 2. Keine dokumentierte Backup-Erwartung für die Postgres-Daten (niedrig)

Weder `delivery/security.md` noch `delivery/devops.md` benennen eine Backup-/Wiederherstellungs-Strategie für `db-data`. Der Vorschlag `delivery/idea/backup-mit-restore-drill-nachweis.md` (2026-07-30) liegt weiterhin unverändert als offene Idee vor — kein Dump-/Snapshot-Mechanismus im Repo, kein Restore-Nachweis, keine Backup-Status-Kachel. (Nicht zu verwechseln mit dem umgesetzten req-031 "Backup-Codes neu erzeugen" — das betrifft WebAuthn-Recovery-Codes, nicht die Datenbank.)

**Empfehlung:** unverändert — Backup-Erwartung explizit festlegen (z. B. via Skill `setup-security`) und den vorliegenden Idee-Vorschlag zur Umsetzung priorisieren, statt ihn als offene Idee liegen zu lassen.

**Verifikation:** aus Code/Config erschlossen (kein Backup-Skript/-Workflow im Repo; Ideen-Datei bestätigt den Status als noch nicht umgesetzt).

## 3. Bekannte High-Severity-Lücken in von Next.js gebündelten Paketen (niedrig)

`npm audit` meldet jetzt 4 statt 3 High-Severity-Advisories: weiterhin `postcss` (≤8.5.22, u. a. Path-Traversal/Info-Disclosure via `sourceMappingURL`) und `sharp` (<0.35.0, von libvips geerbte CVEs), neu dazu `nanoid` (<3.3.17, Endlosschleife bei `size: 0` in Custom-Generatoren). Alle drei sind transitiv von `next@15.5.21` gebracht (`postcss` → `nanoid`). `npm outdated` zeigt `next@15.5.23` als "wanted", `16.3.0` als "latest" (Major-Sprung). `npm audit fix --force` würde `next` fälschlich auf eine Canary-Version (`9.3.4-canary.0`–`16.3.0-preview.10`) setzen.

Kein praktischer Angriffspfad im Projekt: kein Treffer für `next/image`-Nutzung in `app/`/`components/` (erneut geprüft), `postcss` verarbeitet zur Laufzeit keine von außen kommende CSS-Eingabe, und der `nanoid`-Bug greift nur bei `customAlphabet(..., 0)`, was im Code nirgends aufgerufen wird.

**Empfehlung:** unverändert — kein sofortiger Handlungsbedarf, bei nächster Next.js-Version mit gepatchtem `postcss`/`sharp`/`nanoid` aktualisieren; vor Einführung von `next/image` erneut prüfen.

**Verifikation:** live (`npm audit` gegen aktuelle `package-lock.json`) + Code-Grep für `next/image` und `customAlphabet`.

---

Nicht prüfbar aus dieser Umgebung: Cloudflare-Dashboard-Konfiguration (Tunnel-/DNS-/TLS-Einstellungen direkt) und GitHub-Branch-Protection auf `main`.
