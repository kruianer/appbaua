---
type: code-review
repo: AppBaua
commit: 3eddff6
date: 2026-10-20
---

# Code-Review: AppBaua (3eddff6)

Automatisch erstellt vom appbaua-Worker am 2026-10-20.

---
type: code-review
repo: AppBaua
commit: 3eddff6
date: 2026-10-20
---

# Code-Review: AppBaua (3eddff6)

Bezug: [delivery/reviews/2026-10-13-code-review-appbaua-37f9fe7.md](delivery/reviews/2026-10-13-code-review-appbaua-37f9fe7.md).

Seit dem letzten Bericht (`37f9fe7`, 2026-10-10) sind **90 Commits** gelandet, `git diff --stat 37f9fe7..HEAD` → 139 Dateien, +13.603/−303 Zeilen. Das ist der größte Diff seit Beginn dieser Berichtsreihe und enthält echten Code: ein komplettes neues Chat-Feature (req-040/048/049, bug-028 bis bug-037), Container-Übersicht (req-042), Release-Infos (req-046), Wochenbudget (req-044), Selbstbeauftragung (req-047) und die neue Seitenleiste (req-039/041).

**Eine Einschränkung vorab, zur Transparenz:** Diese Prüfung lief in einer interaktiven Sitzung ohne `docker`, ohne `gh` und ohne Shell im Worker-Container — anders als der letzte Bericht, der den laufenden Container direkt vermessen hat. Ich konnte den git- und GitHub-Stand (Branches, PRs, Commits) über die GitHub-API prüfen, aber **nicht**, welcher Commit tatsächlich im laufenden Worker- bzw. App-Container steht. Befund 1 unten stützt sich entsprechend nur auf Repo-Ebene, nicht auf eine Container-Messung.

**Quality Gate (lokal gefahren):** `NODE_ENV=test npx vitest run` → **1505/1514 grün**, 9 übersprungen, 96 Testdateien — alle neuen Tests bestehen. `npm run typecheck` sauber. `npm run lint` unverändert dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157). `npm audit --json` → **`{high: 4, critical: 1, total: 5}`** über `nanoid`, `next`, `postcss`, `sharp`, `source-map-js` — unverändert zu allen Vorberichten.

Von den 27 Vorbefunden des letzten Berichts habe ich die sicherheits- und betriebsrelevanten selbst sowie über zwei Teilprüfungen nachgeprüft (Details unten). Zusätzlich habe ich die komplett neuen Module (Chat-Sitzungsverwaltung, Container-Neustart, Budget, Release-Info) erstmals gelesen.

---

## Kritisch

### 1. Der Rückstand von `dev` auf `main` ist nicht kleiner geworden, sondern von 19 auf **109 Commits** gewachsen — weiterhin keine Anzeige, weiterhin kein PR

Letzter Bericht: 19 Commits / 32 Tage Rückstand, gemessen am laufenden Container. Diesmal auf Repo-Ebene über die GitHub-API geprüft:

```
GET /repos/kruianer/appbaua/compare/main...dev → ahead_by: 109, behind_by: 0
main zuletzt bewegt: 8e5dab4, 2026-09-11 14:56 (Commit: "Etappen-Push mit Rebase-Retry")
Letzter gemergter PR (dev→main): #7, 2026-07-27 — danach kein weiterer PR, auch kein offener.
```

`main` steht seit **39 Tagen** auf demselben Commit. In den 109 ungemergten Commits liegen u. a. bug-022 bis bug-037 (Prozessbaum-Leak, Pausen-Logik, Werkzeugkette, Chat-Stabilität) und das gesamte neue Chat-Feature. Ob der tatsächlich laufende Container diesem Rückstand entspricht, konnte ich diesmal nicht direkt prüfen (siehe Einschränkung oben) — aber `delivery/devops.md:176` erlaubt dem Worker ausdrücklich, den PR zu öffnen, und das ist in zwei Berichten in Folge nicht passiert. Nichts im Repo zeigt diesen Rückstand an; `lib/github-repos.ts` (Befund 9) spricht bereits mit der GitHub-API und könnte das.

**Fix, unverändert aus dem letzten Bericht:** (a) den PR `dev`→`main` öffnen (Merge bleibt beim Nutzer), (b) eine Zeile im Dashboard/Verlauf, die den Rückstand gegen `origin/main` nennt.

### 2. `finishRegistrationAndSignIn` meldet weiterhin anhand eines Feldes an, das der Angreifer frei setzt

**Unverändert, selbst geprüft.** `lib/auth-finish-registration.ts:26`:

```ts
const cred = await getAuthStore().getCredential(response.id);
```

`finishRegistration` (`lib/auth-webauthn.ts:102-124`) verifiziert die Attestation und kennt die echte Credential-ID (`verification.registrationInfo.credential.id`, Zeile 121), gibt sie aber nur als `{ ok: true }` zurück — nicht an den Aufrufer. `finishRegistrationAndSignIn` greift stattdessen auf `response.id` aus dem Request-Body zu, eine im WebAuthn-Modell öffentliche, vom Client gesendete ID. Ein eingeladener Nutzer kann im Body die Credential-ID eines anderen (z. B. des Betreibers) einsetzen und wird über `signIn(cred.userId)` (Zeile 29) mit dessen Sitzung angemeldet. Dritte Woche in Folge, Fix bleibt eine Zeile: `finishRegistration` die verifizierte ID zurückgeben lassen und diese statt `response.id` verwenden.

### 3. NEU: Zwei Nachrichten an dasselbe Repo starten zwei parallele Claude-Läufe im selben Git-Arbeitsverzeichnis

`app/api/chat/[repoId]/messages/route.ts:38` ruft `startChatTurn(repo, content)` ungeprüft auf — kein Blick auf `isChatTurnRunning(repo.id)`, das in `lib/chat-session-manager.ts:278` existiert, aber hier nicht benutzt wird. Zwei Tabs, ein Doppelklick vor dem Re-Render des Composers, oder einfach ein zweiter POST während der erste noch läuft: Beide Aufrufe bekommen dasselbe `prepareChatRepo`-Arbeitsverzeichnis (deterministisch aus der Repo-URL, `lib/chat-workspace.ts`) und starten dort parallel `runClaude`. Zwei Claude-Prozesse, die gleichzeitig im selben Checkout committen/pushen, sind ein Git-Datenrennen mit echtem Korruptions- bzw. Verlustrisiko — nicht bloß ein UI-Glitch. Zusätzlich überschreibt der zweite Aufruf den `runningControllers`-Eintrag (`chat-session-manager.ts:182`): Der Stopp-Knopf trifft danach nur noch den zweiten Lauf, der erste läuft unsichtbar weiter.

**Fix:** In `startChatTurn`/der Route früh prüfen, ob für `repo.id` schon ein Turn läuft, und in diesem Fall ablehnen statt einen zweiten zu starten (die Funktion existiert dafür bereits, sie wird nur nicht aufgerufen).

### 4. NEU: Der Datei-Store für Chat-Sitzungen hat kein Schreibschutz — Lost-Update bei jedem gleichzeitigen Chat-Turn

`lib/chat-session-store.ts:88-96` (`appendMessage`, File-Variante, Default ohne `DATABASE_URL`):

```ts
async appendMessage(msg) {
  const all = await readAll();
  ...
  all.messages.push(full);
  await writeAll(all);   // schreibt die GESAMTE Datei neu
}
```

Kein Lock, kein atomic rename. Das Feature erlaubt laut req-040 bis zu **fünf gleichzeitig aktive Chat-Sitzungen** — genau der Fall, den dieser Code nicht abdeckt: Laufen zwei Repos gleichzeitig (nicht einmal dasselbe Repo, es reicht irgendeine Überlappung), lesen beide `appendMessage`-Aufrufe denselben alten Dateistand und der zweite Schreibvorgang überschreibt den ersten komplett — eine Nachricht verschwindet ohne Fehler, ohne Log. Die Postgres-Variante (`lib/pg-store.ts:586-628`) ist davon nicht betroffen (INSERT pro Zeile); betroffen ist nur der File-Store, der ohne `DATABASE_URL` der Default ist. Dasselbe Muster wie der seit mehreren Berichten bekannte Lost-Update-Befund für den Auth-Store (Vorbefund 18), jetzt mit einer konkreten neuen Fünffach-Parallelität als Auslöser.

### 5. NEU: `app/api/health/containers/restart/route.ts` startet jeden Container auf dem Host ohne Autorisierungsprüfung neu

```ts
export async function POST(request: Request) {
  const body = ...;
  if (typeof body.id !== "string" || body.id === "") { ... }
  const result = await restartContainer(body.id);   // keine Prüfung, wem die Session gehört
  ...
}
```

`middleware.ts` kommentiert selbst (Zeilen 6-12): „Middleware can only check that the cookie NAMES a session … the real check happens in the auth API routes". Diese Route macht diesen zweiten Check nicht — `restartContainer` (`lib/container-overview-service.ts:135-160`) sucht `body.id` ungefiltert über **alle** Docker-Container des Hosts, auch fremde Apps, auch prod. Jedes gültige Session-Cookie (siehe Befund 6) reicht, um jeden Container neuzustarten. Dasselbe Muster wie die seit zehn Berichten bekannte Lücke (`health/restart`), hier in einer in diesem Diff neu entstandenen zweiten Route reproduziert — das dokumentierte Verfahren „zweite Prüfung in der Route" wird beim Anlegen neuer Routen weiterhin nicht automatisch mitgezogen.

### 6. Middleware prüft weiterhin nur „Cookie vorhanden" — elftes Review in Folge, Verhältnis verschlechtert

**Unverändert, Zahlen verschlechtert.** `middleware.ts:38`: `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. `find app/api -name route.ts | wc -l` → **43** (zuletzt 33); `grep -rln "userIdForSession\|currentUser" app/api/` → weiterhin **3**. Verhältnis jetzt **3:43** statt 3:33 — die neuen Routen (Container-Neustart, Budget, Release-Info, Selbstbeauftragung, Chat) sind durchweg ohne die zweite Prüfung entstanden.

### 7. Ein einziger unauthentifizierter POST sperrt die Installation weiterhin dauerhaft zu

**Unverändert.** `lib/auth-bootstrap.ts:31` (`countUsers() > 0`), `app/api/auth/bootstrap/status/route.ts:11-12`, `middleware.ts` gibt `/api/auth` komplett frei. Wer prod neu aufsetzt (nach Befund 1 steht das ohnehin aus), läuft durch dieses Fenster.

---

## Wichtig

### 8. NEU: Die LRU-Verdrängung einer Chat-Sitzung beendet nicht den laufenden Claude-Prozess

`lib/chat-session-manager.ts:140-143`: `touchActiveSession` liefert `{ active, evicted }` zurück, aber nur `touched.active` wird verwendet — `touched.evicted` wird im ganzen Modul nirgends gelesen. Der Docstring in `lib/chat-session-lru.ts:14` ist dazu ehrlich: „beendet" meint ausdrücklich nur, dass der Eintrag aus der Buchhaltungs-Menge fällt, nicht dass ein laufender Prozess gestoppt wird. Das ist für den häufigen Fall (verdrängte Sitzung ist längst fertig, nur noch im Gespräch gespeichert) harmlos. Läuft die verdrängte Sitzung aber tatsächlich noch (sechste Nachricht kommt, während fünf andere Repos noch aktiv rechnen), bleibt ihr Claude-Kindprozess bis zu `CLAUDE_TIMEOUT_MS` (120 min) unbeaufsichtigt weiterlaufen — der Stopp-Knopf des verdrängten Repos trifft dann nichts mehr. Ob req-040s „wird … beendet" diesen Fall einschließen sollte, ist eine Auslegungsfrage; dass der Fall heute unbehandelt ist, ist ein Fakt.

### 9. `lib/preview.ts` vernichtet weiterhin gerettete Etappen im selben Durchgang

**Unverändert.** `buildPreview` ruft pro aktivem Repo weiterhin `prepareRepoOnConvention` → `checkoutTracking` → `git reset --hard origin/<branch>` (`lib/workspace.ts:575-584`) + `git clean -fd`, und `lib/worker-loop.ts` ruft `updatePreview()` weiterhin zweimal pro Durchgang (Zeile 157 und 355). Was `pushStages` lokal rettet, weil der Push fehlschlug, vernichtet die Vorschau Sekunden später im selben Lauf. Fix unverändert: Vorschau braucht keinen `reset --hard`, nur `ready/`.

### 10. Zwei Netzwerk-Erkennungen widersprechen sich weiterhin

**Unverändert.** `lib/network-abort.ts` klassifiziert über eine eigene Wortliste, nicht über `lib/error-kind.ts`s `LOCAL_RESOURCE_PATTERNS` (inkl. `ENOMEM`). Speichernot gilt weiterhin als Netzstörung und legt dreimal den Pass still.

### 11. Werkzeugkette aus bug-024 fehlt weiterhin `linux-headers`

**Unverändert.** `Dockerfile.worker:44-46`: `make gcc g++ musl-dev python3-dev`, kein `linux-headers`, kein `pkgconf`. Pakete, die gegen `<linux/…>` kompilieren (z. B. `psutil`), scheitern weiterhin.

### 12. NEU: „req-039" existiert jetzt — bedeutet aber etwas anderes, als worauf verwiesen wird

Letzter Bericht bemängelte, req-039 existiere nirgends. Jetzt gibt es `delivery/requirements/done/req-039-untere-navigation-fuenf-plaetze.md` — ein fertiges, unverwandtes Requirement (untere Navigation, fünf Plätze). `Dockerfile.worker:42`, `dockerfile-worker.test.ts:67` und `delivery/bugs/done/bug-024-….md:110,154` verweisen weiterhin auf „req-039" als „die dauerhafte Antwort, wo ein Repo seine Systemabhängigkeiten selbst ansagt" — das ist jetzt keine Lücke mehr, sondern eine **falsche** Referenz: Wer der Nummer folgt, findet ein fertiges, fachlich fremdes Requirement und könnte fälschlich annehmen, die Dependency-Deklaration sei bereits gelöst. Ein Test (`dockerfile-worker.test.ts:84-88`) hält vier Pakete anhand dieser Begründung draußen.

**Fix:** Die Verweise durch eine neue, korrekte Requirement-Nummer ersetzen oder entfernen.

### 13. `lib/github-repos.ts` schluckt weiterhin jeden Fehler und kappt still bei 500 Repos

**Unverändert.** `if (!res.ok) break;` (Zeile 43), Seitenlimit `page <= 5` ohne Hinweis, kein Fetch-Timeout.

### 14. `npm audit` + `next.config.ts images`: fünfte Woche mit demselben Zwei-Schritte-Rezept

**Unverändert.** `grep -n images next.config.ts` → kein Treffer. `npm audit fix` + `images: { unoptimized: true }` weiterhin nicht umgesetzt.

### 15. NEU: Beim Chat lässt ein fehlgeschlagener Versand den Composer dauerhaft im „Senden…"-Zustand stehen

`components/Chat.tsx:264-268` (`send`): `await fetch(...)` prüft `res.ok` nicht; ein Non-2xx (z. B. 404 `unknown-repo`, wenn das Repo zwischen Laden der Liste und Absenden entfernt wurde) wird vom umgebenden `try/catch` nicht erfasst, da `fetch` bei HTTP-Fehlerstatus nicht wirft. `pendingByRepo[repoId]` bleibt `true`, weil serverseitig nie ein Turn gestartet wurde und `msgs.length` nie wächst. Der Poll-Effekt (Zeilen 211-228) hat keinen Timeout-Fallback — er wartet, bis `msgs.length > before`, und das passiert nie. `cancel()` (Zeilen 280-296) hilft nicht: Es läuft ja nichts zum Abbrechen. Ergebnis: Composer zeigt dauerhaft „läuft"/Stopp ohne Wirkung, nur ein Reload hilft.

**Fix:** `res.ok` prüfen und bei Fehlschlag `pendingByRepo` sofort zurücksetzen plus eine Systemnachricht einfügen (dasselbe Muster, das `sendChatMessage` serverseitig schon für andere Fehlerfälle benutzt).

### 16. `discardChanges` fehlt weiterhin im `doc`- und `recurring`-Zweig

**Unverändert.** Aufrufer in `lib/execute-step.ts` bei Zeile 283 (`keepStages`), 616, 641, 658 — der `doc`-Zweig pusht direkt (`push("worker: Doku aktualisiert")`) ohne vorheriges `discardChanges`, ebenso der generische `recurring`-Zweig. Beide können fremde Änderungen im Arbeitsverzeichnis mitcommitten.

### 17. `parkFailed` pusht weiterhin fremde bzw. rote Commits statt nur die `.md` zu verschieben

**Unverändert.** `discardChanges` (`lib/workspace.ts:796-799`) macht nur `git reset --hard` auf `HEAD` + `clean -fd` — bereits lokal committete Arbeit bleibt stehen und wird von `parkFailed` mitgepusht, auch wenn das Test-Gate dafür rot war.

---

## Kleinere Punkte

**Aus früheren Reviews, unverändert nachgeprüft:**

- `lib/review-report.ts:61-70` — `reportFileName` ohne Uhrzeit/Zähler, zwei Läufe am selben Tag/Commit überschreiben sich still.
- `lib/security-report.ts:42-46` — `hasSecurityFindings` hängt an einem exakten Zauberwort.
- `lib/review-report.ts:46-49` — `isoDate` nutzt lokale statt UTC-Zeit; bei UTC-Containern verschiebt sich das Berichtsdatum nachts.
- `lib/dev-branch.ts:125-132` — `isBranchName` lässt den reservierten Namen `HEAD` durch.
- `lib/docker.ts:35-42` — `isAllowedCommand` prüft nur `cmd[0]`; `psql` in der Erlaubnisliste ist faktisch beliebige Befehlsausführung über Argumente.
- `lib/redact.ts:41` — `WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS`.
- `delivery/devops.md` nennt weiterhin `deploy/*.env`, der Deploy liest `$HOME/appbaua-env/{dev,prod}.env`; `deploy` steht nicht in `.gitignore`.
- `grep -rn "^\s*TZ:"` über alle Compose-/Dockerfiles → weiterhin kein Treffer; Container laufen in UTC.

**Neu, aus dem heute erstmals gelesenen Code:**

- `lib/budget.ts:35` (`startOfWeek`) berechnet den Wochenbeginn über lokale Containerzeit (`getFullYear/getMonth/getDate/getDay`) statt UTC — dieselbe systemische Lücke wie bei `isoDate` (siehe oben), jetzt im neuen, budgetrelevanten Feature: Bei einem UTC-Container verschiebt sich der Wochenwechsel um 1-2 Stunden gegenüber der deutschen Kalenderwoche.
- `lib/release-info-source.ts`/`-service.ts`: gelesen und geprüft — liest ausschließlich über die GitHub-Contents-API, kein lokales FS, keine Befehlsausführung, kein vom Nutzer kontrollierter Pfad. Kein Befund.

**Aus früheren Reviews, nicht erneut einzeln nachgeprüft (Liste unverändert zum letzten Bericht):** Backup-Code wird vor Abschluss der Recovery-Ceremony verbrannt; Challenges/Sessions werden nie aufgeräumt; kein Rate-Limit auf Auth-Routen; Sitzungs-Cookie ohne `maxAge`; `installProcessTreeCleanup` fehlt in `instrumentation.ts`; `newCode()`/`getOperator()`/`issueBackupCodes`/`rpId()`/`redeemInvitation` wie zuletzt beschrieben; `killAllProcessTrees` räumt `liveGroups` nicht; `health-agent` ohne Token-Prüfung; `lib/acceptance-criteria.ts` toter Code.

---

## Was gut ist

**Die Behandlung verlorener Chat-Sitzungen (bug-029) ist sauber gelöst.** `lib/chat-session-manager.ts:196-210`: Erkennt `runClaude`, dass die `--resume`-Session-ID dem CLI unbekannt ist (typischerweise nach einem Container-Neustart), verwirft sie und startet exakt einmal mit einer neuen Session neu — dieselbe Nachricht, ohne dass der Nutzer etwas merkt außer einer minimal längeren Antwortzeit. Das ist der richtige Umgang mit einem Zustand, der nicht verhindert werden kann, nur abgefedert.

**Das OOM-Problem aus bug-026 ist jetzt wirklich behoben, nicht nur dokumentiert.** `docker-compose.yml:159-160` setzt `mem_limit`/`memswap_limit: 6g` mit Begründungskommentar — der seit mehreren Berichten offene Vorbefund „kein `mem_limit` für irgendeinen Container" ist für den Worker-Dienst geschlossen.

**Die Testabdeckung des neuen Chat-Features ist ungewöhnlich dicht für ein Feature dieser Größe:** 39 Tests allein in `Chat.test.tsx`, dazu `chat-session-manager.test.ts` (792 Zeilen), `chat-worker-independence.test.ts`, eigene Tests für LRU-Verdrängung und Idle-Timeout. Dass dabei trotzdem die Lücken aus den Befunden 3, 4, 8 und 15 durchgerutscht sind, liegt daran, dass alle vier **Parallelität zwischen zwei Sitzungen** betreffen — ein Testfall, den eine Suite ohne expliziten Gleichzeitigkeitstest strukturell nicht findet, egal wie dicht sie sonst ist.

**`release-info-source.ts`/`-service.ts`** sind ein gutes Beispiel für den richtigen Umgang mit fremdem Input: ausschließlich über die GitHub-API, kein lokales Dateisystem, kein Fallback auf Befehlsausführung — genau dort, wo in diesem Repo wiederholt Befehlsausführung/Pfadprobleme auftauchen (`lib/docker.ts`, `lib/github-repos.ts`), ist hier keines entstanden.

---

**Empfehlung:**

**Befund 1 bleibt vor jedem anderen Fix.** Der Rückstand ist gewachsen statt geschrumpft (19 → 109 Commits), und zwei Berichte in Folge haben denselben Fix empfohlen, ohne dass der PR geöffnet wurde. Das macht jeden Fix in diesem und im letzten Bericht wirkungslos, solange niemand weiß, was tatsächlich läuft.

**Dann Befund 3** — die fehlende Sperre gegen parallele Chat-Turns, weil sie Git-Arbeitsverzeichnisse beschädigen kann, nicht nur eine Anzeige verwirrt. Die Prüfung existiert bereits (`isChatTurnRunning`) und muss nur in der Route aufgerufen werden — eine Zeile.

**Dann Befund 2** (WebAuthn-Credential-ID) — vierte Woche unverändert, Fix bleibt eine Zeile, Risiko ist Account-Takeover auf einen eingeladenen Nutzer.

**Dann Befund 5** — die neue ungeschützte Neustart-Route, weil sie zeigt, dass das in `middleware.ts` dokumentierte Verfahren („zweite Prüfung in der Route") bei neuen Routen nicht mitgezogen wird. Lohnt sich, als generische Prüfung (Middleware oder gemeinsamer Helfer) statt als Einzelfix pro Route zu lösen — Befund 6 zählt mit 43 Routen und nur 3 geprüften inzwischen zu groß für Einzelfixe.

**Befund 14** bleibt der billigste Posten: `npm audit fix` + `images: { unoptimized: true }`, fünfte Woche im Rezept, eine Viertelstunde.

**Zusammenfassung:** 90 Commits seit dem letzten Bericht, erstmals seit vier Wochen wieder mit substantiellem neuem Code: ein komplettes Chat-Feature samt Sitzungsverwaltung, Container-Übersicht, Wochenbudget, Release-Infos und Selbstbeauftragung. Quality Gate grün (1505/1514 Tests, 9 übersprungen, Typecheck sauber, Lint unverändert 5 False Positives, `npm audit` unverändert 1 kritisch + 4 high). Der schwerste Befund ist derselbe wie letzte Woche und hat sich verschlechtert: `dev` liegt jetzt 109 Commits / 39 Tage vor `main`, ohne Anzeige und ohne geöffneten PR — diese Prüfung lief allerdings nur auf Repo-Ebene (kein Docker-Zugriff in dieser Sitzung), nicht gegen den tatsächlich laufenden Container. Neu und eigenständig schwer: Das neue Chat-Feature hat keine Sperre gegen zwei parallele Läufe auf demselben Repo (Git-Datenrennen im geteilten Arbeitsverzeichnis) und sein File-Store-Pfad hat kein Schreibschutz (Lost-Update bei paralleler Nutzung der neuen Fünffach-Gleichzeitigkeit) — zwei Lücken, die eine noch so dichte Testsuite ohne expliziten Gleichzeitigkeitstest nicht findet, und genau diese Suite hat trotz 39 neuer Testdateien keinen solchen Test. Dazu eine zweite, in einer neuen Route reproduzierte Instanz der seit zehn Berichten bekannten Autorisierungslücke (Container-Neustart). Alle sicherheits- und betriebsrelevanten Vorbefunde, die ich nachgeprüft habe, sind unverändert offen; `npm audit`/`next.config.ts` zum fünften Mal mit vollständig vorliegendem Rezept. Auf der positiven Seite: bug-026 (Speicherlimit) ist jetzt wirklich umgesetzt, nicht nur dokumentiert, und die Behandlung verlorener Chat-Sessions (bug-029) ist ein gutes Beispiel für robuste Fehlerbehandlung an der richtigen Stelle. Ich habe nichts committet und nichts gepusht; der Arbeitsbaum ist sauber.
