---
type: code-review
repo: AppBaua
commit: 6dfed86
date: 2026-11-03
---

# Code-Review: AppBaua (6dfed86)

Automatisch erstellt vom appbaua-Worker am 2026-11-03.

Alle Prüfungen sind gelaufen. Hier ist der Bericht.

---

# Code-Review appbaua (Branch `dev`, Stand 6dfed86)

Bezug: [delivery/reviews/2026-10-27-code-review-appbaua-0a4478c.md](delivery/reviews/2026-10-27-code-review-appbaua-0a4478c.md).

Seit dem letzten Bericht (`0a4478c`) sind **6 Commits** gelandet. Code hat sich nur in einem davon geändert:

- **bug-042: Der Chat-Verlauf lässt sich seitlich rollen.** Geändert sind `components/Chat.tsx` (+13/−1) und `components/Chat.test.tsx` (+55).
- Der Rest betrifft nur `delivery/`: der Review-Bericht vom 27.10., der Security-Bericht vom 28.10. und eine neue Idee (`chat-pushes-durch-testgate-und-verlauf.md`).

Unter `lib/`, `app/` und `middleware.ts` gab es keine Änderung. **Alle Vorbefunde aus dem letzten Bericht sind deshalb zwangsläufig unverändert offen.** Ein paar davon habe ich trotzdem stichprobenartig im Code nachgesehen (siehe unten).

Im Code habe ich nichts geändert und nichts committet oder gepusht.

**Quality Gate (in dieser Sitzung selbst ausgeführt):**

- `NODE_ENV=test npx vitest run`: **1543/1552 grün**, 9 übersprungen, 98 Testdateien. Das sind 3 Tests mehr als beim letzten Mal (die von bug-042), kein roter.
- `npm run typecheck`: sauber.
- `npm run lint`: unverändert dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157).
- `npm audit`: **`{critical: 1, high: 4}`**, unverändert.
- `origin/dev` liegt **6 Commits** vor `origin/main` (letzter Stand von `main`: 2026-10-23). bug-042 ist also noch nicht auf prod. Das ist kein Befund, nur der Stand fürs Human-Gate.

---

## Kritisch

### 1. Mit einem erfundenen Cookie hat man vollen Zugriff auf prod, und dafür gibt es weiterhin keinen Bug und kein Requirement

**Unverändert, selbst nachgesehen.** In `middleware.ts:38` steht weiterhin nur `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Bisher stand der Punkt in diesen Reviews als „die Middleware prüft nur, ob ein Cookie vorhanden ist“. Der Security-Bericht vom **2026-10-28** (`delivery/security/2026-10-28-security-appbaua-f8eaf0d.md`) hat das jetzt **live gegen dev und prod nachgewiesen**. Mit `Cookie: appbaua_session=fake` kamen bei `/api/repos`, `/api/worker-state` und `/api/run-log` echte Daten mit `200` zurück.

Dazu kommt der Chat (req-040), der hinter derselben Prüfung liegt: `claude --dangerously-skip-permissions` mit `GITHUB_TOKEN` in der Umgebung. Damit ist das eine **Codeausführung, die von außen über das Internet erreichbar ist**. Der Kommentar in `middleware.ts:7-10` behauptet weiterhin eine zweite Prüfung, die es nicht gibt.

Ich stufe das deshalb höher ein als in den letzten Berichten. Ausschlaggebend ist ein Prozessproblem: **Unter `delivery/bugs/ready/` und `delivery/requirements/ready/` liegt nichts.** Der Befund ist also seit Wochen dokumentiert, aber nicht in der Pipeline. Der Worker wird ihn so nie abarbeiten.

**Empfehlung:**
- Sofort einen Bug anlegen (Skill `capture-bug`).
- Inhalt des Fixes: Ein gemeinsamer Helfer `withSession()` prüft die Session gegen den Store, in jeder nicht-öffentlichen Route und Server-Komponente.
- Bis der Fix auf prod ist: Cloudflare Access vor beide Hostnamen schalten. Das geht ohne Code-Änderung.

### 2. `finishRegistrationAndSignIn` meldet weiterhin anhand der vom Client gesendeten Credential-ID an

**Unverändert, selbst nachgesehen.** `lib/auth-finish-registration.ts:26`: `getCredential(response.id)`, und `response.id` kommt aus dem Request-Body. Der Fix bleibt eine Zeile: die verifizierte ID aus `finishRegistration` zurückgeben und verwenden. **Das ist die sechste Woche in Folge.**

### 3. Parallele Chat-Züge im selben Repo sind weiterhin möglich

**Unverändert, selbst nachgesehen.** `app/api/chat/[repoId]/messages/route.ts:40` ruft `void startChatTurn(repo, content)` weiterhin ohne Prüfung mit `isChatTurnRunning` auf. Begründung und einzeiliger Fix wie im letzten Bericht (Befund 1): 409 zurückgeben, wenn schon ein Zug läuft.

### 4. Container-Neustart ohne Autorisierung, und ein Bootstrap-POST ohne Anmeldung sperrt eine frische Installation

Unverändert (Vorbefunde 3 und 4). Befund 1 verschärft beides: Der Container-Neustart ist dadurch faktisch öffentlich erreichbar.

---

## Wichtig

### 5. Vorbefunde aus dem letzten Review, unverändert, weil sich `lib/` nicht geändert hat

- **Chat-Arbeitskopie zieht `origin` nie nach** (Vorbefund 5, `lib/workspace.ts:606-609`). Fix: `merge --ff-only origin/<branch>`.
- **`checkout -B` kann bei `keepLocalWork` ungepushte Commits verwerfen** (Vorbefund 6, `lib/workspace.ts:712`).
- **Chat-Schritte wachsen ohne Grenze** und werden bei jedem Poll komplett übertragen. Im Datei-Store fehlt ein Lock (Vorbefund 7).
- **Repo-Auswahl im Chat ist per Tastatur nicht bedienbar** (Vorbefund 8).
- **Favicon-Abruf ohne Timeout**, ein vorübergehender Fehler wird 24 h gecacht (Vorbefund 9).
- **Weitere betriebsrelevante Vorbefunde:** `preview.ts` ohne `keepLocalWork`, uneinheitliche Netzfehler-Erkennung, `Dockerfile.worker`, `discardChanges`/`parkFailed`.
- **`npm audit`:** 1 critical / 4 high, `next.config.ts` weiterhin ohne `images`. Das ist die **siebte Woche**, das Vorgehen bleibt dasselbe: `npm audit fix` + `images: { unoptimized: true }`.

Die neue Idee `delivery/idea/chat-pushes-durch-testgate-und-verlauf.md` greift einen verwandten Punkt sinnvoll auf: Chat-Pushes auf `dev` laufen ohne Testgate und hinterlassen keine Spur im Verlauf. Der Befund aus dem letzten Bericht, dass die Chat-Kopie nie nachzieht, ist dort als non-fast-forward-Risiko mitgedacht. Wenn die Idee umgesetzt wird, sollten Vorbefund 5/6 und Befund 3 in dasselbe Requirement.

---

## bug-042 im Detail

Der Fix ist korrekt und klein. Ich habe den Layout-Pfad im Code nachvollzogen. Inhalte, die nach dem Fix noch breiter als der Verlauf sein könnten, habe ich nicht gefunden:

- `CopyCommand` hat `minWidth: 0` und `wordBreak: "break-all"`.
- Schritt-Ziel und Schritt-Ergebnis haben `break-all`.
- Textblöcke haben jetzt `overflowWrap: "anywhere"`.
- Der Schritt-Punkt (`left: -5`) liegt im `marginLeft: 5` der `StepList` und wird von `overflowX: hidden` nicht abgeschnitten.

Kleinere Anmerkungen, nichts davon blockiert:

- **Zwei der vier `minWidth: 0` wirken nicht.** Gemeint sind die an der Nachricht (`Chat.tsx:460`) und an der Blase (`:480`). Der Gesprächsbereich ist ein Flex-Container mit `flexDirection: column`. Dort wirkt `min-width: auto` nur auf die Hauptachse, also die Höhe. Was das Breiterwerden tatsächlich verhindert, ist `overflowWrap: "anywhere"`: Anders als `break-word` senkt es die min-content-Breite. Der Kommentar „ein Flex-Kind ist sonst mindestens so breit wie sein längstes Wort“ stimmt für eine Zeilen-Flexbox, hier aber nicht. Das schadet nicht, kann aber beim nächsten Layout-Bug in die Irre führen.
- **Die Tests prüfen Inline-Styles, nicht das Verhalten.** Das ist in `Chat.test.tsx` offen begründet (jsdom berechnet kein Layout). Der zweite Test fixiert damit aber auch die wirkungslosen `minWidth: 0` (siehe oben). Wenn E2E kommt (`delivery/stack.md`: Playwright „folgt mit dem ersten UI-Flow“), ist „`scrollWidth <= clientWidth` mit langem Pfad“ ein guter, stabiler Kandidat.
- **`overflowX: "hidden"` schneidet künftige Fehler ab, statt sie zu zeigen.** Wird später etwas Breites eingefügt (Tabelle, Bild, Markdown-Codeblock mit `white-space: pre`), ist es abgeschnitten, ohne dass man es merkt, statt rollbar zu sein. Für die heutige reine Textdarstellung ist das in Ordnung. Wer später Markdown-Rendering einführt, sollte daran denken.
- **Reproduce-first ist eingehalten:** zwei Commits, erst der Test (`88211b2`), dann der Fix (`b84574a`). Das entspricht der Vorgabe in `delivery/stack.md`.

---

## Kleinere Punkte

Alle aus früheren Reviews, unverändert:

- `lib/redact.ts`: `WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS` (selbst nachgesehen, kein Treffer).
- `components/Chat.tsx`, `send()`: `res.ok` wird nicht geprüft.
- Favicon-Route ohne `X-Content-Type-Options: nosniff`.
- `lib/review-report.ts`: Ein Bericht mit eigenem Frontmatter bekommt einen doppelten Kopf. Dieser Bericht verzichtet deshalb wieder auf eigenes Frontmatter.
- Nicht erneut einzeln nachgeprüft, Liste wie im letzten Bericht: Backup-Code, Aufräumen von Challenges und Sessions, Rate-Limit auf Auth-Routen, Cookie ohne `maxAge`, `isAllowedCommand`, `health-agent` ohne Token.

---

## Was gut ist

- **bug-042 ist eng geschnitten.** Ein Layout-Bug, ein Layout-Fix, keine Nebenänderungen. Jede neue Zeile hat einen Kommentar mit Bug-Referenz, wie es im Repo üblich ist.
- **Die Testsuite bleibt vollständig grün.** Der Typecheck ist sauber, und Lint zeigt keine neuen Warnungen.
- **Der Security-Task liefert echten Mehrwert.** Er hat den Cookie-Befund von „im Code vermutet“ zu „live auf prod nachgewiesen“ gebracht, ohne schreibende Endpunkte auszulösen.

---

## Empfehlung

1. **Befund 1 sofort als Bug in die Pipeline geben** (`capture-bug`) und bis zum Fix Cloudflare Access vor dev und prod schalten. Das ist live ausnutzbar, und ohne Datei in `ready/` arbeitet der Worker es nie ab.
2. **Befund 2 (Credential-ID):** eine Zeile, sechste Woche offen. Kann in denselben Bug oder ein eigener sein.
3. **Befund 3 (parallele Chat-Züge):** eine Zeile plus Test. Am besten zusammen mit der Idee „Chat-Pushes durch Testgate“ und Vorbefund 5/6 als ein Requirement.
4. **`npm audit fix` + `images: { unoptimized: true }`**, siebte Woche.
5. Optional: Die beiden wirkungslosen `minWidth: 0` aus bug-042 entfernen oder den Kommentar korrigieren.

## Zusammenfassung

Seit dem letzten Bericht ist kaum Code dazugekommen. Der einzige Code-Commit (bug-042) ist korrekt, klein und nach der reproduce-first-Vorgabe getestet. Zwei seiner `minWidth: 0` wirken allerdings nicht, und die Tests prüfen nur Styles. Das Quality Gate lief in dieser Sitzung selbst: 1543/1552 Tests grün, Typecheck sauber, Lint und `npm audit` unverändert (1 critical / 4 high).

Das eigentliche Thema dieser Woche ist nicht der Diff. Der Security-Bericht vom 28.10. hat **gezeigt, dass ein erfundenes Cookie vollen Zugriff auf prod gibt, einschließlich eines Chats, der Code ausführt**. Trotzdem gibt es dafür weder einen Bug noch ein Requirement. Solange das so bleibt, stehen auch die anderen Sicherheits-Vorbefunde (Credential-ID, Container-Neustart, Bootstrap) ohne Termin da. Der wichtigste Schritt ist deshalb, Befund 1 in die Pipeline zu geben und bis zum Fix Cloudflare Access vorzuschalten.
