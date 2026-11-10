---
type: code-review
repo: AppBaua
commit: 5721512
date: 2026-11-10
---

# Code-Review: AppBaua (5721512)

Automatisch erstellt vom appbaua-Worker am 2026-11-10.

# Code-Review appbaua (Branch `dev`, Stand 5721512)

Vorheriger Bericht: [delivery/reviews/2026-11-03-code-review-appbaua-6dfed86.md](delivery/reviews/2026-11-03-code-review-appbaua-6dfed86.md).

**Seit dem letzten Bericht hat sich kein Code geändert.** Zwischen `6dfed86` und `5721512` liegen 3 Commits, und alle betreffen nur `delivery/`:

- `599bcb2`: der Review-Bericht vom 03.11.
- `a5ea8a1`: der Security-Bericht vom 04.11. (`delivery/security/2026-11-04-security-appbaua-599bcb2.md`)
- `5721512`: eine neue Idee (`delivery/idea/testumfang-wache-gruen-ohne-schwund.md`)

`git diff --stat 599bcb2 HEAD` zeigt nur diese Dateien. In `app/`, `lib/`, `components/`, `middleware.ts` und `package.json` hat sich nichts geändert. Deshalb gibt es diesmal keinen Diff zu prüfen. Ich habe stattdessen nachgesehen, ob die Hauptbefunde noch offen sind, und das Quality Gate erneut laufen lassen. Ich habe keinen Code geändert und nichts committet oder gepusht.

**Quality Gate (in dieser Sitzung ausgeführt):**

- `NODE_ENV=test npx vitest run`: **1543 von 1552 grün**, 9 übersprungen, 98 Testdateien, Exit 0. Gleiche Zahl wie letzte Woche.
- `npm run typecheck`: keine Fehler.
- `npm run lint`: dieselben 5 `react-hooks/exhaustive-deps`-Warnungen wie bisher (`components/TaskControl.tsx`).
- `npm audit`: **1 critical, 4 high**, unverändert. Installiert ist `next@15.5.21`.
- `origin/dev` ist **9 Commits** vor `origin/main`. Der letzte Stand von `main` ist vom 23.10.2026. Für prod wäre nur bug-042 neu, der Rest sind `delivery/`-Dateien.

---

## Kritisch: unverändert offen, im Code nachgesehen

### 1. Mit einem erfundenen Session-Cookie bekommt man vollen Zugriff, und das ist noch immer nicht in der Pipeline

`middleware.ts:38` prüft weiterhin nur, ob ein Cookie da ist: `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Ob die Session gültig ist, prüft es nicht.

Der Security-Bericht vom 04.11. hat das noch einmal **live gegen dev und prod nachgewiesen**. `/api/repos`, `/api/worker-state`, `/api/run-log` und `/` antworten mit erfundenem Cookie mit 200.

Er bringt außerdem zwei neue Punkte, die das Problem verschärfen:

- **Das Repo `kruianer/appbaua` ist öffentlich.** Damit lassen sich die Berichte, die diese Lücke beschreiben, anonym abrufen, und **das gilt auch für diesen Bericht, sobald er gepusht ist**. Ob das Repo inzwischen privat ist, konnte ich nicht prüfen, weil `gh` in dieser Umgebung fehlt.
- **Der Schaden reicht über appbaua hinaus.** Über den Chat (`claude --dangerously-skip-permissions` mit `GITHUB_TOKEN`) und den Health-Agent kommt man voraussichtlich bis zu den anderen Containern auf dem Beelink.

`delivery/bugs/ready/` und `delivery/requirements/ready/` sind **weiterhin leer**. Der Worker kann diesen Befund also nie von sich aus abarbeiten. Dieses Review stellt das zum dritten Mal in Folge fest.

**Empfehlung, Reihenfolge wichtig:**

1. Repo auf privat stellen.
2. Cloudflare Access vor `dev.appbaua.com` und `app.appbaua.com` schalten. Das geht ohne Code-Änderung.
3. Mit `capture-bug` einen Bug anlegen. Der Fix gehört in einen gemeinsamen Helfer, der in jeder nicht-öffentlichen Route und im App-Layout `currentUser()` gegen den Store prüft. Dazu ein Test, der jede Route unter `app/api` mit gefälschtem Cookie aufruft, und den falschen Kommentar in `middleware.ts:4-12` korrigieren.

### 2. Die Registrierung meldet mit der Credential-ID an, die der Client schickt

`lib/auth-finish-registration.ts:26` verwendet weiterhin `getCredential(response.id)`, und `response.id` kommt aus dem Request-Body. Der Fix ist eine Zeile: `finishRegistration` gibt die verifizierte ID zurück, und die wird hier verwendet. **Siebte Woche offen.**

### 3. Im selben Repo können mehrere Chat-Züge gleichzeitig laufen

`app/api/chat/[repoId]/messages/route.ts:40` ruft weiterhin `void startChatTurn(repo, content)` auf, ohne vorher zu prüfen, ob schon ein Zug läuft. Auch `startChatTurn` selbst (`lib/chat-session-manager.ts:305-320`) prüft das nicht. Es überschreibt nur den Eintrag in `runningTurns`.

Zwei Züge arbeiten dann gleichzeitig in derselben Arbeitskopie. `isChatTurnRunning` gibt es schon, und es ist getestet. In der Route wird es nur nicht benutzt. Der Fix: vorher prüfen und mit 409 antworten, dazu ein Test.

### 4. Container-Neustart ohne Berechtigungsprüfung und ein Bootstrap-POST ohne Anmeldung

Beides unverändert, wie in den Vorberichten. Wegen Befund 1 kann den Container-Neustart praktisch jeder auslösen.

---

## Wichtig: unverändert, weil sich `lib/` nicht geändert hat

Diese Punkte habe ich nicht alle erneut einzeln geprüft. Sie können sich aber nicht geändert haben, weil es keinen Code-Commit gab.

- **Chat-Arbeitskopie holt Änderungen von `origin` nie nach** (`lib/workspace.ts:606-609`). Bei `keepLocalWork` und gleichem Branch passiert nichts (`return`). Vorschlag: `merge --ff-only origin/<branch>`.
- **`checkout -B` kann bei `keepLocalWork` ungepushte Commits verwerfen** (`lib/workspace.ts:712`).
- **Die Liste der Chat-Schritte wächst ohne Grenze** und wird bei jeder Abfrage komplett übertragen. Im Datei-Store fehlt eine Sperre gegen gleichzeitiges Schreiben.
- **Die Repo-Auswahl im Chat ist mit der Tastatur nicht bedienbar.**
- **Der Favicon-Abruf hat kein Timeout**, und ein vorübergehender Fehler wird 24 Stunden gecacht.
- **`npm audit`: 1 critical, 4 high.** Laut Security-Bericht vom 04.11. behebt schon das kleine Update auf `next` 15.5.29 die kritischen Advisories, darunter Codeausführung über die Bild-API, die ohne Cookie erreichbar ist. Zusätzlich sinnvoll: in `next.config.ts` den Eintrag `images: { unoptimized: true }` setzen, dort steht bisher nichts zu `images`. **Achte Woche offen.** Das ist die einfachste wirksame Änderung auf dieser Liste.
- Weitere Betriebspunkte aus früheren Berichten: `preview.ts` ohne `keepLocalWork`, Netzfehler werden an verschiedenen Stellen unterschiedlich erkannt, `Dockerfile.worker`, `discardChanges`/`parkFailed`.

---

## Zur neuen Idee „Testumfang-Wache“

Ich habe die Behauptungen in `delivery/idea/testumfang-wache-gruen-ohne-schwund.md` am Code nachgeprüft. Sie stimmen:

- `exec()` in `lib/test-gate.ts:188ff.` liefert bei Erfolg nur das Ergebnis Grün. Wie viele Tests liefen und wie viele übersprungen wurden, wird nicht ausgewertet.
- Wie viele Tests übersprungen werden, sehe ich nur, weil ich die Zahl hier von Hand notiere: diese Woche wieder 9.

Die Idee passt gut zu der Vorgabe „Quality Gates nie umgehen“ in der Vision. Sie ist aber **weniger dringend als Befund 1–3**. Sie schützt gegen ein Risiko, das bisher nicht eingetreten ist, während Befund 1 auf prod ausnutzbar ist.

---

## Kleinere Punkte

Alle aus früheren Reviews und unverändert:

- In `lib/redact.ts` fehlt `WATCHDOG_TOKEN` in `SECRET_ENV_VARS`. Selbst nachgesehen: kein Treffer.
- `components/Chat.tsx`, `send()`: `res.ok` wird nicht geprüft.
- Die Favicon-Route setzt kein `X-Content-Type-Options: nosniff`.
- `lib/review-report.ts` setzt vor einen Bericht mit eigenem Frontmatter einen zweiten Kopf. Dieser Bericht hat deshalb kein eigenes Frontmatter.
- bug-042: Zwei der vier `minWidth: 0` (`Chat.tsx:460`, `:480`) wirken nicht, und der Kommentar dazu führt in die Irre.
- Nicht erneut geprüft: Backup-Code, Aufräumen von Challenges und Sessions, Rate-Limit auf Auth-Routen, Cookie ohne `maxAge`, `isAllowedCommand`, `health-agent` ohne Token.

---

## Was gut ist

- **Die Suite ist stabil:** 1543 grüne Tests, Typecheck ohne Fehler, keine neuen Lint-Warnungen.
- **Security-Task und Ideen-Task finden echte Probleme.** Der Hinweis, dass das Repo öffentlich ist, und die Korrektur zum Next-Update auf 15.5.29 sind wertvoll.

---

## Empfehlung

1. **Heute, ohne Code:** Repo auf privat stellen und Cloudflare Access vor dev und prod schalten.
2. **Befund 1 als Bug in `delivery/bugs/ready/` anlegen** (`capture-bug`). Ohne diese Datei passiert nichts.
3. **`next` auf 15.5.29 heben und `images: { unoptimized: true }` setzen.** Danach den normalen Weg gehen: dev, PR, Freigabe durch den Betreiber, `main`.
4. **Befund 2 und 3** in denselben Bug oder in einen eigenen aufnehmen. Beide sind je eine Zeile plus Test.
5. Danach die Testumfang-Wache und die Idee „Chat-Pushes durch Testgate“ zusammen mit den Arbeitskopie-Befunden als ein Requirement.

## Zusammenfassung

Seit dem letzten Review gibt es keinen neuen Code, und das Quality Gate ist unverändert grün (1543 von 1552 Tests, 9 übersprungen). Das Hauptproblem ist aber weiterhin da: Mit einem erfundenen Cookie bekommt man vollen Zugriff auf prod, auch auf den Chat, der Code ausführt. Das Repo, in dem diese Berichte liegen, ist zudem öffentlich. Für keinen der Sicherheitsbefunde gibt es einen Bug oder ein Requirement in `ready/`, und solange das so bleibt, arbeitet der Worker sie nicht ab. Der nächste Schritt muss deshalb vom Betreiber kommen: Repo auf privat stellen, Cloudflare Access einschalten, Bug anlegen.
