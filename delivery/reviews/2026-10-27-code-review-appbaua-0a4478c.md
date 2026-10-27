---
type: code-review
repo: AppBaua
commit: 0a4478c
date: 2026-10-27
---

# Code-Review: AppBaua (0a4478c)

Automatisch erstellt vom appbaua-Worker am 2026-10-27.

Ich habe das Review des Repos fertig. Seit dem letzten Bericht (`3eddff6`) kamen 20 Commits dazu. Neu sind vor allem der Chat-Zeitstrahl (req-051), Favicons je Repo (req-050) und die Chat-Arbeitskopie, die ungepushte Arbeit behält und selbst pushen kann (bug-038 bis bug-041). Die Prüfungen habe ich in diesem Lauf selbst ausgeführt: alle Tests grün, Typecheck sauber, Lint ohne neue Warnungen. Im Code habe ich nichts geändert und nichts committet oder gepusht. Nur im Gedächtnis-Index habe ich eine überholte Zeile korrigiert („keine Shell im Container“ stimmt seit August nicht mehr).

---

# Code-Review appbaua (Branch `dev`, Stand 0a4478c)

Bezug: [delivery/reviews/2026-10-20-code-review-appbaua-3eddff6.md](delivery/reviews/2026-10-20-code-review-appbaua-3eddff6.md).

Seit dem letzten Bericht (`3eddff6`) sind **20 Commits** gelandet. `git diff --stat 3eddff6..HEAD` ergibt 34 Dateien, +1.740/−127 Zeilen. Inhalt:

- req-050: Favicon je Repo im Chat
- req-051: Schritte als Zeitstrahl
- bug-038: Chat-Sitzung überlebt den Tab-Wechsel
- bug-039: Antwort erscheint ohne nächste Frage
- bug-040: Chat-Arbeitskopie behält ungepushte Arbeit
- bug-041: Chat pusht über einen Credential-Helper

Gelesen habe ich den gesamten Code-Diff dieser Commits sowie die Vorbefunde, die mit Sicherheit und Betrieb zu tun haben.

**Quality Gate (in dieser Sitzung selbst ausgeführt):**

- `NODE_ENV=test npx vitest run`: **1540/1549 grün**, 9 übersprungen, 98 Testdateien. Das sind 35 Tests mehr als beim letzten Mal, kein roter.
- `npm run typecheck`: sauber.
- `npm run lint`: dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157). Dazu kommt der Hinweis, dass `next lint` abgekündigt ist.
- `npm audit`: **`{critical: 1, high: 4}`**, unverändert.

---

## Erledigt seit dem letzten Bericht

- **Vorbefund 1 (Rückstand `dev` → `main`) ist gelöst.** PR #9 wurde am 2026-10-23 gemergt. `git rev-list --count origin/main..origin/dev` ergibt **0**. Damit ist der schwerste Befund der letzten drei Berichte geschlossen.
- **Vorbefund 15 (Composer bleibt bei Fehler im „Senden…“-Zustand) ist zur Hälfte gelöst.** Seit bug-039 hört das Nachfragen auf, sobald der Server `running: false` meldet und keine Absende-Anfrage mehr unterwegs ist (`components/Chat.tsx`, `postingRef`). Ein 404 auf das POST lässt die Ansicht also nicht mehr ewig hängen. Weiterhin fehlt aber die Prüfung `res.ok`. Der Nutzer sieht seine Nachricht, bekommt nie eine Antwort und erfährt nicht, warum.
- **Vorbefund 8 (LRU/Leerlauf) ist teilweise entschärft.** `pruneIdleSessions` lässt Repos mit laufendem Zug jetzt stehen (`busy`-Set, `lib/chat-session-lru.ts`). Ein laufender Zug wird damit nicht mehr nach einer Stunde aus der Buchhaltung geworfen. Die LRU-Verdrängung beendet einen laufenden Prozess weiterhin nicht (`touched.evicted` wird nicht gelesen).

---

## Kritisch

### 1. Parallele Chat-Züge im selben Repo sind weiterhin möglich und durch bug-040 riskanter geworden

**Unverändert offen (Vorbefund 3), selbst geprüft.** `app/api/chat/[repoId]/messages/route.ts:40` ruft `void startChatTurn(repo, content)` weiterhin ohne Vorprüfung auf. Pikant: Dieselbe Datei importiert `isChatTurnRunning` jetzt (für bug-038, im GET), nutzt es im POST aber nicht.

Warum es durch bug-040 schlimmer wird:

- Früher hat jeder Zug die Arbeitskopie mit `reset --hard` auf `origin` gesetzt. Zwei parallele Züge haben sich gegenseitig die Änderungen weggeworfen. Das war schlecht, aber am Ende sauber.
- Seit `keepLocalWork: true` (`lib/chat-workspace.ts:26`) bleibt alles liegen. Zwei Claude-Prozesse committen und pushen im selben Checkout und **teilen sich jetzt auch die ungepushten Commits und den halbfertigen Arbeitsbaum des jeweils anderen**.
- Dazu kommt, dass beide Läufe sich gegenseitig den `runningControllers`- und den `currentSteps`-Eintrag überschreiben. Stopp-Knopf und Zeitstrahl zeigen dann nur noch den zweiten Lauf.

Die Oberfläche verhindert den Fall nur im selben Tab. Zwei Tabs, ein zweites Gerät oder ein erneutes POST reichen.

**Fix (eine Zeile):** Im POST `if (isChatTurnRunning(repo.id)) return NextResponse.json({ error: "turn-running" }, { status: 409 });`. Dazu ein Test, der zwei POSTs hintereinander schickt.

### 2. `finishRegistrationAndSignIn` meldet weiterhin anhand der vom Client gesendeten Credential-ID an

**Unverändert, selbst geprüft.** `lib/auth-finish-registration.ts:26` ruft `getAuthStore().getCredential(response.id)` auf. `response.id` stammt aus dem Request-Body, nicht aus der verifizierten Attestation. Ein Eingeladener kann so die Sitzung eines anderen Nutzers bekommen. Der Fix bleibt eine Zeile: Die verifizierte ID aus `finishRegistration` zurückgeben und verwenden. Das ist die fünfte Woche in Folge.

### 3. Container-Neustart ohne Autorisierungsprüfung, und die Middleware prüft nur, ob ein Cookie vorhanden ist

**Unverändert, selbst geprüft.** `app/api/health/containers/restart/route.ts` reicht `body.id` ungeprüft an `restartContainer` durch. `middleware.ts` prüft nur, ob ein Session-Cookie existiert. Der Security-Bericht vom 2026-10-21 führt denselben Punkt als „hoch“.

Neu in diesem Diff ist eine weitere Route ohne zweite Prüfung: `app/api/repos/[id]/favicon/route.ts`. Inhaltlich ist sie harmlos, weil sie nur Bilder von `main` liefert. Sie bestätigt aber das Muster: Jede neue Route entsteht ohne Prüfung in der Route selbst. Eine gemeinsame Lösung in der Middleware oder über einen gemeinsamen Helfer ist überfällig.

### 4. Ein unauthentifizierter Bootstrap-POST sperrt eine frische Installation weiterhin dauerhaft

**Unverändert** (Vorbefund 7, `lib/auth-bootstrap.ts`).

---

## Wichtig

### 5. NEU: Die Chat-Arbeitskopie holt Neues von `origin`, zieht es aber nie nach. Antworten beziehen sich ohne Hinweis auf alten Code

`lib/workspace.ts:606-609` (bug-040): Mit `keepLocalWork` passiert nach dem `fetch` nichts mehr, wenn man schon auf dem Branch steht. Der Docstring (`PrepareDeps.keepLocalWork`) sagt dazu: „Claude pulls it itself“. Nichts im Chat sagt Claude das aber:

- Die Nachricht geht unverändert als Prompt an `runClaude`.
- In `lib/chat-*.ts` steht nirgends eine Anweisung zum Pullen.

**Folge:** Der Worker pusht laufend auf `dev`. Ein Chat, der vor Tagen geöffnet wurde, steht auf einem alten Stand des lokalen `dev` und beantwortet Fragen wie „was macht X?“ anhand von Code, den es so nicht mehr gibt. Ein Push aus dem Chat scheitert dann an „non-fast-forward“. Claude kann das selbst auflösen, aber erst nachdem es auf altem Stand gearbeitet hat.

**Fix:** Im Zweig mit `keepLocalWork`, wenn man schon auf dem Branch steht, `git merge --ff-only origin/<branch>` versuchen. Das ändert nichts, sobald es lokale Commits oder Konflikte gibt, und ist damit verlustfrei. Scheitert es, reicht ein Satz in der Systemnachricht: „Arbeitskopie weicht von origin ab“.

### 6. NEU: Bei `keepLocalWork` kann `checkout -B` ungepushte Commits verwerfen, genau im Fall von bug-040/041

`lib/workspace.ts:712`: Benennt `devops.md` einen Branch, den der Remote (noch) nicht hat, läuft auch im Chat-Modus `git checkout -B <branch>` an der aktuellen Stelle von HEAD.

- Steht die Arbeitskopie gerade auf einem anderen Branch, wird ein schon vorhandener lokaler `<branch>` mit ungepushten Commits auf HEAD zurückgesetzt. Die Commits sind dann nur noch über das Reflog erreichbar.
- Ein Branch, den es lokal gibt, auf dem Remote aber nicht, ist genau die Lage, die bug-041 („Chat kann nicht pushen“) erzeugt hat.

Selten, aber genau der Fall, gegen den bug-040 schützen soll. **Fix:** Im Chat-Modus erst `rev-parse --verify refs/heads/<branch>` aufrufen und den Branch bei einem Treffer nur auschecken, nicht neu setzen. Dieselbe Logik steht schon in `checkoutTracking` (Zeile 610 ff.).

### 7. Datei-Store für Chat-Nachrichten: weiterhin Lost-Update, jetzt mit deutlich größeren Datensätzen

**Vorbefund 4, unverändert** (`lib/chat-session-store.ts:88`: `readAll` → `push` → `writeAll`, ohne Lock).

Neu ist req-051. Jede Antwort speichert ihre Schritte als JSON, und `lib/chat-steps.ts` übernimmt dabei den **vollständigen Inhalt jedes `Write`/`Edit`** (Zeile 47), bis zu `MAX_RESULT_CHARS = 100_000` **je Schritt**. Ein Zug, der zwanzig Dateien schreibt, legt so leicht mehrere MB in eine einzige Nachricht. Daraus folgt dreierlei:

- Der Datei-Store schreibt bei **jeder** neuen Nachricht die ganze Datei neu. Der Aufwand wächst mit der Gesamtgröße aller Gespräche, und das Fenster für ein Lost-Update wird größer.
- `GET /api/chat/[repoId]/messages` liefert alle Nachrichten samt Schritten, und der Client fragt das während eines laufenden Zugs alle 1,5 s ab (`POLL_MS`). Das sind mehrere MB je Poll.
- In Postgres wächst `chat_messages.steps` ohne Grenze. Das ist kein Fehler, aber ein Kostenfaktor ohne Aufräumen.

**Fix:** Pro Zug ein Gesamtlimit für die gespeicherten Schritte (z. B. 1 MB). Außerdem sollte `GET messages` die Schritte älterer Antworten weglassen oder kürzen und sie erst beim Aufklappen nachladen. Das Lock im Datei-Store bleibt der Fix aus dem letzten Bericht.

### 8. NEU: Die Repo-Auswahl im Chat ist per Tastatur nicht mehr bedienbar

`components/Chat.tsx` (req-050):

- Das echte `<select>` ist jetzt mit `tabIndex={-1}` (Zeile 731) und `opacity: 0` versteckt.
- Die neue Auswahl ist ein `<button>`, der eine `<ul role="listbox">` öffnet. Die `<li role="option">` (Zeile 704) sind nicht fokussierbar und reagieren nur auf `onClick`. Es gibt keine Pfeiltasten, kein Enter und kein Escape, und ein Klick daneben schließt die Liste nicht.

Am iPhone stört das nicht, am Desktop mit Tastatur kommt man aber nicht mehr an ein anderes Repo. Die `role`-Attribute versprechen Screenreadern ein Verhalten, das nicht da ist. **Fix:** Optionen als `<button>` rendern (fokussierbar, Enter funktioniert dann von selbst), Escape und Klick daneben schließen die Liste. Oder `role="listbox"`/`option` weglassen, statt sie nur zu behaupten.

### 9. NEU: Favicon-Abruf ohne Timeout, und ein vorübergehender Fehler wird 24 Stunden lang als „kein Favicon“ gemerkt

`lib/repo-favicon.ts:63-98`:

- Es gibt bis zu **13 nacheinander laufende** GitHub-API-Aufrufe je Repo, jeweils ohne `AbortSignal`/Timeout. Ein hängender Aufruf blockiert die Route, und damit hängt jedes `<img>` im Repo-Picker.
- Jeder Fehler (Netz, 403 wegen Rate-Limit, 5xx) wird wie „Datei nicht vorhanden“ behandelt (`continue`). Das Ergebnis `null` landet für `FAVICON_TTL_MS` = 24 h im Cache (Zeile 98). Ein kurzer GitHub-Ausfall beim ersten Öffnen kostet so einen ganzen Tag Platzhalter.

Dasselbe Muster wie Vorbefund 13 (`lib/github-repos.ts`). **Fix:** Pro Aufruf ein Timeout (`AbortSignal.timeout(5000)`). `null` nur cachen, wenn alle Antworten echte 404 waren, und sonst nicht oder nur kurz.

### 10. Vorbefunde mit Betriebsrelevanz, unverändert

- `lib/preview.ts`: `buildPreview` → `prepareRepoOnConvention` ohne `keepLocalWork` → `reset --hard` + `clean -fd` vernichtet weiterhin Etappen, die im selben Durchgang lokal gerettet wurden (Vorbefund 9). Seit bug-040 gibt es dafür einen fertigen Schalter. Die Vorschau könnte ihn nutzen, sie braucht nur `ready/`.
- `lib/network-abort.ts` und `lib/error-kind.ts` erkennen Netzfehler weiterhin unterschiedlich (Vorbefund 10).
- `Dockerfile.worker` ohne `linux-headers` (Vorbefund 11). Die falsche Referenz auf „req-039“ steht weiterhin drin (Vorbefund 12).
- `discardChanges` fehlt im Zweig `doc`/`recurring`, und `parkFailed` pusht lokal committete rote Arbeit mit (Vorbefunde 16, 17).
- `npm audit` 1 critical / 4 high. `next.config.ts` enthält weiterhin kein `images` (Vorbefund 14). Das ist die sechste Woche, das Vorgehen bleibt dasselbe: `npm audit fix` + `images: { unoptimized: true }`.

---

## Kleinere Punkte

**Neu:**

- `components/Chat.tsx`, `send()`: `res.ok` wird weiterhin nicht geprüft (siehe „Erledigt“ oben). Ein 404/500 beim Absenden endet still ohne Systemnachricht.
- `app/api/repos/[id]/favicon/route.ts`: Die CSP für SVG ist richtig gesetzt. Es fehlt aber `X-Content-Type-Options: nosniff`, das bei vom Nutzer kontrollierten Bilddaten zum Standard gehört.
- `lib/repo-favicon.ts`: `ref=main` ist fest eingetragen. Repos mit dem Standard-Branch `master` bekommen immer den Platzhalter. req-050 sagt ausdrücklich „von main“, das ist also korrekt umgesetzt. Ein Rückgriff auf den Standard-Branch des Repos würde trotzdem nichts kosten.
- `lib/workspace.ts`, `ENV_CREDENTIAL_HELPER`: Das ist sauber gelöst. Das Token landet nicht in `.git/config`, sondern kommt zur Laufzeit aus `$GITHUB_TOKEN`. Der Helper steht aber dauerhaft in der `.git/config` der Chat-Arbeitskopie. Jeder Prozess, der dort mit diesem Env läuft, bekommt also Push-Rechte. Für den Chat ist das genau so gewollt. Das sollte in `delivery/security.md` (falls vorhanden) bzw. im nächsten Security-Lauf vermerkt werden.
- `lib/review-report.ts:88-102` setzt jedem Bericht Frontmatter und H1 voran. Berichte, die selbst mit Frontmatter beginnen, haben dadurch einen doppelten Kopf (siehe `2026-10-20-…-3eddff6.md`, Zeilen 1-21). Dieser Bericht verzichtet deshalb auf eigenes Frontmatter. Besser wäre, ein vorhandenes führendes Frontmatter in `doc.report` vor dem Voranstellen zu entfernen.

**Aus früheren Reviews, unverändert nachgeprüft:**

- `lib/redact.ts:41`: `WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS`. Das wiegt jetzt schwerer, weil die Chat-Schritte vollständige Datei-Inhalte und Befehlsausgaben speichern und dabei nur über `redact` geschwärzt werden.
- `lib/review-report.ts`: `reportFileName` ohne Uhrzeit. `isoDate` und `lib/budget.ts` (`startOfWeek`) rechnen mit der lokalen Containerzeit, die Container laufen in UTC.

**Aus früheren Reviews, nicht erneut einzeln nachgeprüft:** Die Liste ist unverändert zum letzten Bericht (Backup-Code, Aufräumen von Challenges und Sessions, Rate-Limit auf Auth-Routen, Cookie ohne `maxAge`, `isAllowedCommand`, `health-agent` ohne Token usw.).

---

## Was gut ist

**bug-039 ist an der richtigen Stelle behoben.** Das Ende eines Zugs erkennt der Client jetzt am Server-Signal `running`, nicht mehr an der Zahl der Nachrichten. `postingRef` deckt das kurze Fenster ab, in dem das POST noch unterwegs ist. Damit entfällt eine ganze Klasse von Wettläufen, auch der hängende Composer aus Vorbefund 15.

**Der Credential-Helper (bug-041) ist die sauberste Token-Lösung im Repo.** Kein Token in der URL, keins in `.git/config` und keins in der Kommandozeile. Ältere Arbeitskopien werden über `remote set-url` geheilt. Der Test prüft ausdrücklich, dass nur der Variablenname gespeichert wird.

**`lib/chat-steps.ts` ist gut geschnitten.** Pure Logik ohne DOM, getrennt von der Oberfläche. Geschwärzt wird beim Herausgeben je Feld statt auf dem fertigen JSON, und Schritte im alten Textformat (req-049) werden weiter gelesen. Ergebnisse sind gekappt (aber siehe Befund 7: die Grenze gilt je Schritt, nicht je Zug).

**Die Testdisziplin hält.** Jeder der vier Bugfixes hat einen eigenen Test, der den Fehler zuerst nachstellt (z. B. „die Antwort steht ohne weitere Nachricht da, auch wenn die Nachrichtenzahl vorher schon stimmte“). Das entspricht der Vorgabe „reproduce-first“ aus `delivery/stack.md`.

---

## Empfehlung

1. **Befund 1 (parallele Chat-Züge):** eine Zeile plus Test. Mit bug-040 teilen sich zwei parallele Läufe jetzt ungepushte Arbeit. Die Funktion für die Prüfung ist in der Route schon importiert.
2. **Befund 2 (WebAuthn-Credential-ID):** eine Zeile, Risiko Übernahme eines Kontos, fünfte Woche offen.
3. **Befund 5 + 6 (Chat-Arbeitskopie):** `merge --ff-only` nach dem Fetch und kein `checkout -B` auf einen vorhandenen lokalen Branch. Beides schließt Lücken des gerade gelieferten bug-040, solange er noch frisch ist.
4. **Befund 3 (Autorisierung in den Routen):** als gemeinsame Lösung, nicht pro Route.
5. **Befund 10 / audit:** `npm audit fix` + `images: { unoptimized: true }`, sechste Woche mit demselben Vorgehen.

## Zusammenfassung

20 Commits seit dem letzten Bericht, alle rund um den Chat: Zeitstrahl, Favicons, eine Sitzung, die den Tab-Wechsel übersteht, und eine Arbeitskopie, die ungepushte Arbeit behält und selbst pusht. Das Quality Gate ist in dieser Sitzung lokal grün gelaufen (1540/1549 Tests, Typecheck sauber, Lint unverändert, `npm audit` unverändert 1 critical / 4 high).

Die wichtigste gute Nachricht: **`main` ist mit `dev` gleichgezogen** (PR #9 vom 2026-10-23, Rückstand 0). Der Hauptbefund der letzten drei Berichte ist damit erledigt.

Der schwerste offene Punkt ist die fehlende Sperre gegen parallele Chat-Züge. bug-040 hat ihn verschärft, weil die Arbeitskopie nicht mehr zurückgesetzt wird. Dazu kommen zwei Lücken im neuen Modus `keepLocalWork`: Die Kopie zieht Neues von origin nie nach, und `checkout -B` kann ungepushte Commits verwerfen. Außerdem wächst die gespeicherte Schritte-Historie ohne Grenze und wird bei jedem Poll komplett übertragen. Die Sicherheits-Vorbefunde (Credential-ID, Prüfung nur auf vorhandenes Cookie, Container-Neustart, Bootstrap) sind unverändert offen.
