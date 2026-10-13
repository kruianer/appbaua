---
type: code-review
repo: AppBaua
commit: 37f9fe7
date: 2026-10-13
---

# Code-Review: AppBaua (37f9fe7)

Automatisch erstellt vom appbaua-Worker am 2026-10-13.

# Code-Review appbaua (Branch `dev`, Stand 37f9fe7)

Bezug: [delivery/reviews/2026-10-06-code-review-appbaua-aa5e9b9.md](delivery/reviews/2026-10-06-code-review-appbaua-aa5e9b9.md).

Seit dem letzten Bericht sind vier Commits gelandet, und anders als in der Woche davor ist diesmal Code dabei: bug-024 hat die `apk add`-Zeile der `Dockerfile.worker` um neun Pakete erweitert (`1b54c81` Bugreport, `37f9fe7` Fix) und dafür eine neue Testdatei mitgebracht. `git diff --stat aa5e9b9..HEAD` → 6 Dateien, 955 Zeilen, davon 118 Zeilen ausführbare Build-Konfiguration und Test.

Diesen Diff habe ich nicht nur gelesen, sondern dort geprüft, wo er wirkt: **im laufenden Container**. Das ist seit bug-024 möglich — die Systemwerkzeuge sind wieder da, der Worker hat eine Shell. Das Ergebnis dieser Messung ist der schwerste Befund dieses Berichts, und er hat mit dem Inhalt des Fixes nichts zu tun, sondern damit, wo er liegt.

**Quality Gate (live gefahren):** `NODE_ENV=test npx vitest run` → **1187/1187 grün**, 9 übersprungen, 77 Testdateien. Das sind genau +8 Tests und +1 Datei gegenüber letzter Woche (1179/76) — die acht Tests der neuen `dockerfile-worker.test.ts`, Zahl für Zahl aufgegangen. `npm run typecheck` sauber. `npm run lint` unverändert dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157), plus die Deprecation-Warnung von `next lint`. `npm audit --json` → **`{high: 4, critical: 1, total: 5}`** — unverändert zur letzten Woche.

Alle 27 Vorbefunde habe ich einzeln am heutigen Code nachgeprüft. **Alle 27 sind unverändert offen.**

---

## Kritisch

### 1. NEU: Der Worker, der diesen Bericht schreibt, läuft auf `main` — 19 Commits und 32 Tage hinter `dev`. bug-022, bug-023 und bug-024 sind geschrieben und nicht in Kraft.

Das ist der wichtigste Befund dieses Berichts, und er ist in elf Vorberichten nicht vorgekommen, weil elf Vorberichte den `dev`-Baum gelesen haben. Der `dev`-Baum ist aber nicht, was arbeitet.

Gemessen im Container, der gerade läuft:

```
perl FEHLT · python3 FEHLT · exiftool FEHLT · make FEHLT · gcc FEHLT
g++ FEHLT · ffmpeg FEHLT · convert FEHLT · magick FEHLT · sqlite3 FEHLT
jq FEHLT · pip3 FEHLT
```

Das ist, Werkzeug für Werkzeug, **dieselbe Liste wie in bug-024 am 2026-10-10** — drei Tage nach dem Commit, der sie behebt, und zwei Tage nachdem die Bugdatei nach `delivery/bugs/done/` gewandert ist.

Die Herkunft des Images ist eindeutig, nicht erschlossen:

| Messung | Wert |
|---|---|
| `git hash-object /app/lib/workspace.ts` | `f479c0f…` |
| `git rev-parse origin/main:lib/workspace.ts` | `f479c0f…` — **identisch** |
| `git hash-object /app/lib/worker-loop.ts` | `1384d2f…` |
| `git rev-parse origin/main:lib/worker-loop.ts` | `1384d2f…` — **identisch** |
| `/lib/apk/db/installed` (Zeitpunkt der `apk add`-Schicht) | 2026-07-30 02:08 |
| `/proc/uptime` | 5,0 Tage (Start ~2026-10-08 04:30 UTC) |
| `git rev-list --count origin/main..origin/dev` | **19** |

Der laufende Worker ist also exakt `origin/main` = `8e5dab4` vom **2026-09-11**. Die `apk add`-Schicht stammt vom 30. Juli, und das ist sogar korrekt gecacht: auf `main` hat die Zeile seit `71ef14d` (28. Juli) niemand angefasst. Der Container ist zwei Tage **vor** dem bug-024-Fix gestartet und seitdem nicht neu erzeugt worden.

Was damit geschrieben, getestet, reviewt und nicht in Betrieb ist:

- **bug-024** (`37f9fe7`) — die Systemwerkzeuge. Oben gemessen: fehlen. Claude baut sich weiterhin auf jedem Lauf eine Perl- bzw. Python-Umgebung nach `/tmp`, und bei jedem nächsten Lauf ist sie wieder weg. Die sieben von zehn Läufen über 40 Minuten, die der Bug gezählt hat, laufen weiter.
- **bug-023** (`046b076`) — der Prozessbaum. `grep -c "installProcessTreeCleanup\|killProcessTree" /app/lib/workspace.ts` → **0**. `grep -c installProcessTreeCleanup /app/worker/index.ts` → **0** (auf `dev`: 2). Der Ausfall, den bug-023 dokumentiert hat — verwaiste Testprozesse fressen den Speicher, bis der Container nicht mehr forken kann —, ist in dem Container, der arbeitet, vollständig ungedeckt. Vorbefund 17 der letzten Woche hat diskutiert, ob `installProcessTreeCleanup` auch den SIGKILL-Pfad des OOM-Killers abdeckt. Die Funktion ist nicht einmal deployt.
- **bug-022** (`986c4dd`) — die abbrechbare Pause.

Die drei Bugfixes der letzten fünf Wochen. Alle drei beheben Probleme **des Workers selbst**, alle drei liegen auf `dev`, alle drei wirken nicht.

**Das ist kein Regelbruch, und ich will es nicht als einen darstellen.** `delivery/devops.md:174-186` ist eindeutig: Promotion geht ausschließlich über einen PR von `dev` nach `main`, und mergen darf nur der Nutzer. Dass prod hinter dev liegt, ist die Bauart dieses Projekts. Der Befund ist ein anderer, und er besteht aus zwei Teilen:

**Erstens: nichts im Repo macht diese Lücke sichtbar.** `delivery/devops.md:176-177` erlaubt dem Worker ausdrücklich, den PR zu *öffnen* („Der Worker öffnet ihn höchstens"). Gesucht, wer das tut: `grep -rln "pull request\|pulls\|gh pr\|createPullRequest"` über `lib app components worker agent` → **kein Treffer**. Der einzige „pull"-Fund in `lib/workspace.ts:963` ist ein Prosa-Kommentar. Es gibt keinen Erzeuger dieses PRs, keine Anzeige „prod läuft auf X, dev steht bei Y", keine Verlaufszeile, keine Telegram-Meldung. 19 Commits und 32 Tage Rückstand sind nirgends ablesbar — nicht im Dashboard, nicht im Verlauf, nicht in `delivery/`. Der Nutzer kann ein Gate nur bedienen, von dessen Warteschlange er erfährt.

**Zweitens, und das ist der Teil, der diesen Bericht betrifft: das Review-Verfahren selbst kann es nicht finden.** Elf Berichte haben den `dev`-Baum geprüft und bugfix-Befunde als „behoben" abgehakt, während die Maschine unverändert weiterlief. bug-024 schreibt „Behoben am 2026-10-10". Das stimmt für das Repo und ist für den Rechner falsch. Keine Prüfung in diesem Repo stellt die Frage, ob das, was im Repo steht, das ist, was läuft.

Und daran hängt der Fix von bug-024 besonders unglücklich — siehe Befund 2.

**Fix, in der Reihenfolge der Wirkung:** (a) Den PR von `dev` nach `main` öffnen — das ist erlaubt, nicht getan und der einzige Schritt, der die drei Bugfixes in Betrieb bringt; der Merge bleibt beim Nutzer. (b) Den Rückstand sichtbar machen: eine Zeile im Dashboard oder im Verlauf, die den Commit nennt, auf dem der laufende Worker steht, gegen `origin/dev`. Die Teile liegen bereit — `headCommit` existiert, `lib/github-repos.ts` redet schon mit der GitHub-API. (c) Für diesen Bericht und alle folgenden: Der Code-Review-Task prüft `dev`, aber wenigstens eine Messung muss gegen den laufenden Stand gehen, sonst sind Sätze wie „unverändert offen" über Betriebsverhalten nicht belegbar.

### 2. NEU: Der Test zu bug-024 ist grün, der Bug ist live — er prüft den Dateitext, nicht das Image

`dockerfile-worker.test.ts` liest `Dockerfile.worker` als String und prüft, dass die Paketnamen in der `apk add`-Zeile stehen. Das ist ehrlich kommentiert („Er prüft die Build-Konfiguration, weil das Problem nur dort entsteht"), und als Reproduce-first-Test gegen die *Zeile* ist er korrekt: drei der acht Fälle waren gegen den alten Stand rot.

Nur war bug-024 nicht „in der Zeile fehlt etwas". bug-024 war „im Container fehlen die Werkzeuge", gemessen mit elf `command -v`-Aufrufen im laufenden Container. Genau diese Messung macht kein Test. Das Ergebnis steht in Befund 1: acht grüne Tests, `done/`-Ordner, Bugdatei geschlossen — und `perl FEHLT · python3 FEHLT · exiftool FEHLT` an derselben Stelle wie am Tag der Meldung.

Nach `delivery/stack.md` gilt: „Kein Repro-Test → nicht gefixt." Der Test hier erfüllt den Buchstaben und nicht den Zweck, und er ist damit das dritte Exemplar des Musters, das die Befunde 15, 18 und 23 des letzten Berichts beschreiben: ein Test, dessen Name eine Eigenschaft behauptet, die sein Rumpf nicht prüft.

**Dazu eine zweite, engere Lücke im selben Test — belegt, nicht hergeleitet.** Der Parser `apkPackages` (Zeilen 23-40) zieht Zeilenfortsetzungen zusammen, splittet an `&&` und behält nur die Teilbefehle, die auf `apk add` passen. Ein `apk del` fällt durch den Filter. Damit besteht die Standard-Alpine-Redewendung für Übersetzungswerkzeuge — `apk add --virtual .build-deps …` und am Ende `apk del .build-deps` — **jede einzelne Zusicherung dieses Tests**, während im Image keines der fünf Werkzeuge liegt. Mein Prüfstand, grün:

```
const hypothetical = `RUN apk add --no-cache bash git openssh … \
  && apk add --no-cache --virtual .build-deps make gcc g++ musl-dev python3-dev \
  && npm install -g @anthropic-ai/claude-code \
  && apk del .build-deps`;
for (const tool of ["make", "gcc", "g++", "musl-dev", "python3-dev"])
  expect(apkPackages(hypothetical)).toContain(tool);   // grün
```

Das ist kein konstruierter Fall: Der Kommentar im Dockerfile sorgt sich selbst um Image-Größe („jedes Paket kostet Platz im Image und Zeit beim Bauen"), und `--virtual` plus `apk del` ist genau der Griff, zu dem man dann greift. Der Test würde ihn durchlassen und nichts merken. (Der Prüfstand lief, war grün und ist wieder gelöscht; `git status` ist sauber.)

**Fix:** Die Zusicherung dort hinlegen, wo sie wehtut — ein Prüfschritt, der im Image bzw. im laufenden Container `command -v` für die neun Werkzeuge fährt. Im Deploy-Workflow ist das nach `up -d --build` ein `docker compose exec worker sh -c 'command -v perl exiftool python3 …'`, drei Zeilen, und es ist der einzige Ort, an dem Befund 1 künftig auffällt. Der String-Test darf bleiben; er ist schnell und schützt die Absicht. Er darf nur nicht der einzige sein. Ergänzend im Parser: Teilbefehle mit `apk del` ausrechnen statt ignorieren.

### 3. NEU/verschärft: Die geretteten Etappen werden nicht erst beim nächsten Schritt vernichtet, sondern am Ende desselben Durchgangs — durch die Vorschau

Vorbefund 4 steht seit vier Berichten: `checkoutTracking` endet mit `git reset --hard origin/<branch>` (`lib/workspace.ts:515`) und wird aus `prepareRepoOnConvention` gerufen (`:580`, `:612`), also zu Beginn jedes Schritts. Das ist unverändert richtig — und es ist nicht die ganze Geschichte.

Gelesen habe ich diesmal `lib/preview.ts`, ein Modul, das in elf Review-Berichten **null mal** vorkommt. `buildPreview` ruft für jedes aktive Repo `prepareRepoOnConvention` (`lib/preview.ts:37`, `:80`) — dieselbe Funktion, derselbe `reset --hard origin/<branch>`, dasselbe `git clean -fd`. Und `updatePreview` läuft **zweimal pro Durchgang**: am Anfang (`lib/worker-loop.ts:150`, bug-012) und am Ende (`:296`, req-022).

Damit sieht der Weg der geretteten Arbeit so aus:

1. Ein Schritt scheitert. `keepStages` versucht `pushStages`, der Push geht nicht durch (Netz, Rebase-Konflikt), die Commits bleiben lokal. Der Kommentar darüber verspricht wörtlich: „Konnte nicht gepusht werden, bleibt die Arbeit lokal und geht beim nächsten erfolgreichen Lauf mit" (`lib/execute-step.ts:245-246`).
2. Der Durchgang läuft weiter. Ein gewöhnlicher Fehlschlag setzt **keine** Pause, also ist `pauseUntilMs === null`.
3. `lib/worker-loop.ts:295-299` ruft `updatePreview()` → `buildPreview` → `prepareRepoOnConvention` für genau dieses Repo → `reset --hard origin/<branch>`.
4. Die Commits sind weg. Im **selben** Durchgang, Sekunden nach der Rettung, durch den Code, der nur nachsehen wollte, was als Nächstes dran ist.

„Beim nächsten erfolgreichen Lauf" kommt nie. Zwei Commits (`8e5dab4`, `f8a915f`) und ein Docker-Volume sind in die Rettung dieser Etappen gegangen; die Vorschau macht sie zunichte, bevor irgendein nächster Lauf beginnt. Das hebt Vorbefund 4 von „der nächste Schritt überschreibt es" auf „es überlebt den eigenen Durchgang nicht" — und erklärt, warum die Rettung in der Praxis nie etwas gebracht hat.

**Fix:** Die Vorschau braucht keinen `reset --hard`. Sie liest `ready/`, nichts weiter. Entweder bekommt `prepareRepoOnConvention` einen Nur-Lesen-Modus (fetch + checkout ohne Reset und ohne `clean`), oder `buildPreview` liest `ready/` aus `origin/<branch>` statt aus dem Arbeitsbaum (`git ls-tree`). Der Nebeneffekt ist angenehm: Die Vorschau klont/fetcht heute jedes aktive Repo zweimal pro Durchgang, und das wird sie dann nicht mehr tun.

### 4. `finishRegistrationAndSignIn` meldet weiterhin anhand eines Feldes an, das der Angreifer frei setzt

**Unverändert.** `lib/auth-finish-registration.ts:26`: `getAuthStore().getCredential(response.id)` — die rohe, ungeprüfte ID aus dem Request-Body, nicht die, die `finishRegistration` gerade verifiziert hat. Der vollständige Angriff samt Prüfstand steht in Befund 1 des letzten Berichts; die Bibliothek gleicht `response.id` nirgends gegen die Attestation ab, und ein eingeladener Nicht-Betreiber-Nutzer bekommt eine Betreiber-Sitzung. Davor steht allein die Unkenntnis einer Credential-ID — eines im WebAuthn-Modell öffentlichen Bezeichners. Der Fix bleibt eine Zeile.

### 5. Ein einziger unauthentifizierter POST sperrt die Installation weiterhin dauerhaft zu

**Unverändert.** `lib/auth-bootstrap.ts:31` prüft weiterhin `countUsers() > 0`, `app/api/auth/bootstrap/status/route.ts:11` beantwortet dieselbe falsche Frage, und `middleware.ts:22` stellt den ganzen `/api/auth`-Präfix frei. Nutzer angelegt, kein Passkey, kein Backup-Code, keine Sitzung, Ersteinrichtung endgültig geschlossen, Link in der Oberfläche ausgeblendet. Wer prod neu aufsetzt, läuft durch dieses Fenster — und nach Befund 1 ist ein prod-Neuaufsetzen gerade das, was ohnehin aussteht.

### 6. Middleware prüft weiterhin nur „Cookie vorhanden" — zehntes Review in Folge

**Unverändert.** `middleware.ts:38`: `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Heute gezählt: `find app/api -name route.ts` → **33**; `grep -rln "userIdForSession\|currentUser" app/api/` → **3**. Das Verhältnis 3:33 ist seit zehn Berichten unverändert, und dahinter liegen weiterhin `health/restart` (startet fremde prod-Container neu), `health/analyze` (gibt Geld beim KI-Anbieter aus), `repos/*`, `worker-state/*`, `task-types/*`.

### 7. Zwei Netzwerk-Erkennungen widersprechen sich weiterhin

**Unverändert.** `grep -c errorKindOf lib/network-abort.ts` → **0**. `isNetworkAbort` läuft weiterhin über eine eigene Wortlaut-Liste statt über die in `lib/error-kind.ts` begründete Reihenfolge; `ENOMEM`/`EAGAIN` gilt weiterhin als Netzstörung und legt dreimal den kompletten Pass still — in genau dem Maschinenzustand, den bug-023 dokumentiert und dessen Fix nach Befund 1 nicht läuft. Die beiden Befunde verstärken sich: Der Pfad, der aus Speichernot eine Netzstörung macht, ist aktiv; der Pfad, der die Speichernot verhindert, ist es nicht. `lib/network-abort.ts:55` sagt weiterhin „60 minutes", seit `ac2c9b6` sind es 120.

---

## Wichtig

### 8. NEU: Die Werkzeugkette von bug-024 ist an einer vorhersehbaren Stelle unvollständig — `linux-headers` fehlt

Der Kommentar sagt: „node-gyp und pip need exactly this chain" (`Dockerfile.worker:35-38`), gemeint sind `make gcc g++ musl-dev python3-dev`. „Exactly" ist zu stark. Die kanonische Alpine-Baukette für pip-Pakete mit C-Anteil ist `build-base python3-dev linux-headers`, und `linux-headers` fehlt. Pakete, die gegen `<linux/…>` übersetzen — `psutil` ist das alltäglichste Beispiel, und genau solche hängen an „numpy und Verwandte", die der Bugreport als Grund nennt — scheitern damit weiterhin mitten im Lauf, und Claude fängt wieder an, sich etwas nach `/tmp` zu bauen. Dasselbe gilt für `pkgconf`, das viele `setup.py`-Läufe erwarten.

**Fix:** `linux-headers` dazu (ein kleines Paket, nur Header). Wer die Zeile ohnehin anfasst: `build-base` ist das Meta-Paket für `make gcc g++ musl-dev` und ersetzt vier Namen durch einen, ohne die Begründung im Kommentar zu entwerten.

### 9. NEU: Der venv-Weg aus bug-024 hängt am `.gitignore` des fremden Repos — und niemand hat das geprüft

Der Dockerfile-Kommentar und die Bugdatei legen den Weg für Python-Repos fest: eine venv je Repo, `python3 -m venv .venv`. Das ist richtig gedacht (PEP 668, Worker nicht root). Es trifft nur auf `lib/workspace.ts:575` — `git clean -fd`, bei **jedem** Schritt, und seit Befund 3 auch zweimal pro Durchgang aus der Vorschau.

`git clean -fd` **ohne** `-x` lässt ignorierte Dateien stehen. Die venv überlebt also genau dann, wenn das Zielrepo `.venv` in seinem eigenen `.gitignore` führt — und stirbt bei jedem Schritt, wenn nicht. Das ist eine Vorbedingung in einem fremden Repo, von der die Wirksamkeit des Fixes abhängt, und sie steht nirgends: nicht im Dockerfile-Kommentar, nicht in der Bugdatei, nicht als Prüfung im Code. Trifft sie nicht zu, kommt bug-024 für Wellarita in neuer Form zurück — nicht mehr „das Werkzeug fehlt", sondern „die Umgebung ist bei jedem Schritt wieder leer", und das ist dasselbe Symptom und dieselben 42 bis 120 Minuten.

**Fix:** Einen Satz dazu in den Dockerfile-Kommentar (die venv hält nur, wenn das Repo sie ignoriert) — und, dauerhafter, die venv dorthin legen, wo `git clean` nicht hinreicht: ein Pfad neben dem Arbeitsbaum im `worker-work`-Volume, je Repo. Dann ist sie von der `.gitignore`-Disziplin fremder Repos unabhängig.

### 10. NEU: `req-039` ist die „dauerhafte Antwort" an drei Stellen und existiert nirgends

`grep -rln "req-039"` → drei Treffer: `Dockerfile.worker:43`, `dockerfile-worker.test.ts:84`, `delivery/bugs/done/bug-024-….md:110,154`. Alle vier Nennungen verweisen auf req-039 als die eigentliche Lösung („ein Weg, auf dem ein Repo seine Systemabhängigkeiten selbst ansagt"), und zwar als Begründung dafür, `ffmpeg`/`imagemagick`/`sqlite3`/`jq` heute **nicht** aufzunehmen.

Es gibt kein req-039. Die höchste Nummer in `delivery/requirements/` ist **req-038**, und `delivery/requirements/ready/` ist leer (`ls | wc -l` → 0), ebenso `delivery/bugs/ready/` und beide `in-progress/`.

Das ist exakt Vorbefund 17 im neuen Gewand: ein Folge-Requirement, auf das sich eine Entscheidung stützt, das aber niemand angelegt hat. Ein Verweis auf ein nicht existierendes Paket ist keine Vertagung, sondern ein Vergessen mit Fußnote — und dieses hier trägt zusätzlich die Last, dass ein Test (`dockerfile-worker.test.ts:84-88`) vier Pakete aktiv **draußen hält** und seine Begründung aus genau diesem Phantom bezieht.

**Fix:** req-039 nach `delivery/requirements/ready/` schreiben, oder die Verweise entfernen und die Entscheidung auf eigene Füße stellen. Beides ist in Ordnung; der heutige Zustand ist es nicht.

### 11. NEU: `listGithubRepos` schluckt jeden Fehler und kappt still bei 500 Repos

`lib/github-repos.ts` — in elf Berichten null mal erwähnt. Zwei Stellen:

- `if (!res.ok) break;` (`:43`). Ein abgelaufenes Token (401), ein überschrittenes API-Limit (403) und ein GitHub-Ausfall (502) sind damit nicht unterscheidbar von „du hast keine Repos": Die Funktion gibt eine leere oder halbe Liste zurück, und die Add-Repo-Auswahl ist einfach leer. Kein Fehler, keine Meldung, kein Log. Für die eine Variable, an der alles hängt — `GITHUB_TOKEN` treibt auch Klonen und Pushen —, ist die stille Variante die falsche.
- Die Seitenschleife endet bei `page <= 5`, also bei 500 Repos, ohne ein Wort. Der Kommentar nennt das „cap at a few pages to stay responsive" — in der Oberfläche sieht eine gekappte Liste genauso aus wie eine vollständige.

Dazu kommt: kein Timeout am `fetch`. Hängt die GitHub-API, hängt der Route-Handler mit.

**Fix:** Den Nicht-OK-Status als Fehler nach oben geben (die Route kann ihn anzeigen), und bei erreichtem Seitenlimit mitteilen, dass die Liste nicht vollständig ist.

### 12. `npm audit`: weiterhin 1 kritisch + 4 high — vierte Woche mit demselben Zwei-Schritte-Rezept

Live gemessen: `{high: 4, critical: 1, total: 5}` über `nanoid`, `next`, `postcss`, `sharp`, `source-map-js`. Alle fünf mit `fixAvailable: true`. Gegenüber letzter Woche unverändert — der Zuwachs von damals ist geblieben, nichts ist dazugekommen.

Das Rezept steht seit vier Berichten: (a) `npm audit fix` hebt vier der fünf innerhalb der bestehenden Ranges; (b) `images: { unoptimized: true }` in `next.config.ts` macht die kritische AVIF-Bewertung gegenstandslos, ohne auf `next@16` zu warten. Nachgeprüft: `grep -c images next.config.ts` → weiterhin **0**. Eine Viertelstunde, viermal aufgeschrieben, nicht gemacht.

### 13. 7 von 246 Akzeptanzkriterien in `done/` sind abgehakt — Zahl für Zahl unverändert

Heute neu gezählt über alle Dateien: **246** Kriterien in `delivery/requirements/done/`, **7** mit `[x]`, **37 von 38** Dateien ohne ein einziges Häkchen. Identisch zur letzten Woche.

Mit Befund 2 daneben liest sich das schärfer als bisher: Das Häkchen ist der einzige Ort im Verfahren, an dem „gebaut" von „durchgespielt" getrennt wird, und bug-024 ist der Fall, an dem genau diese Trennung gefehlt hat. Acht grüne Tests gegen einen Dateitext, ein `done/`-Ordner — und ein einziges „Werkzeug im Container nachgesehen" hätte gezeigt, dass nichts davon wirkt.

### 14. Der Backup-Code wird weiterhin verbrannt, bevor die Wiederherstellung klappt

**Unverändert.** `lib/auth-recovery.ts:79-80`: `consumeBackupCode(match.id)` steht weiterhin **vor** `startRegistration`. Jeder abgebrochene Face-ID-Dialog, jede abgelaufene Challenge kostet einen von zehn Codes und bringt nichts ein.

### 15. Challenges und Sitzungen werden weiterhin nie aufgeräumt — und `login/start` ist öffentlich

**Unverändert.** `grep -rn "expires_at <" lib/*.ts lib/*.sql` → **0 Treffer**. Kein Aufräumen beim Lesen, keine Retention, kein Takt. Im File-Store ist jede Auth-Operation ein vollständiges `readAll()`/`writeAll()`, also macht jeder unauthentifizierte `login/start` jede künftige Anmeldung langsamer — ein Denial-of-Service per Schleife, ohne etwas zu wissen.

### 16. Keine einzige Auth-Route hat ein Rate-Limit oder eine Sperre

**Unverändert.** `grep -rln "rateLimit\|throttle\|attempts\|lockout" app/api middleware.ts` → **0 Dateien**.

Eine Richtigstellung zur Lesbarkeit dieses Befunds, weil sie beim Nachprüfen auffällt: `lib/rate-limit.ts` **existiert** — es ist aber etwas anderes. Es erkennt das Rate-Limit **des KI-Anbieters** im Ausgabetext eines Claude-Laufs und berechnet daraus die Pause (req-029), und es wird von `error-kind.ts` und `execute-step.ts` ordentlich benutzt. Kein toter Code, kein HTTP-Schutz, keine Doppelung. Der Befund bleibt wie er war; nur der Modulname lädt zum Fehlschluss ein.

### 17. Das Sitzungs-Cookie hat weiterhin keine Lebensdauer

**Unverändert.** `grep -n "maxAge\|expires" lib/auth-cookie-name.ts` → **0 Treffer**, bei `SESSION_TTL_MS` von 30 Tagen serverseitig. Der Nutzer meldet sich nach jedem Browserneustart neu an, die Sitzungszeile lebt 30 Tage weiter (und nach Befund 15 danach auch noch).

### 18. Weitere Vorbefunde, am heutigen Code nachgeprüft und unverändert offen

- **Doku- und recurring-Task committen fremde Änderungen** — `discardChanges` weiterhin nur in `lib/execute-step.ts` an 266/576/593/816, nicht im `doc`- und nicht im recurring-Zweig.
- **Der abgelegte Bericht geht unredigiert ins Repo** — `grep -c redact lib/execute-step.ts` → **0**. Auch dieses Dokument nimmt diesen Weg.
- **`run()` läuft in zwei Prozessen, verdrahtet ist einer** — `installProcessTreeCleanup()` weiterhin nur in `worker/index.ts:12`, nicht in `instrumentation.ts`. (Nach Befund 1 ist es dort, wo es steht, ohnehin nicht im Betrieb.)
- **`killProcessTree`: der einzige erreichbare Rückfallzweig ist der, den die Doku ausschließt** (`lib/workspace.ts:143-153`).
- **Nach `settle` bleiben die Ausgabe-Listener hängen** (`:260-271`, Fix bleibt `if (settled) return;` in `emit`).
- **Kein `mem_limit` für irgendeinen Container** — `grep -c mem_limit docker-compose.yml` → **0**; SIGKILL des OOM-Killers bleibt ungedeckt, das Folge-Requirement fehlt weiterhin.
- **bug-022: die vom Menschen gesetzte Pause wird überschrieben** — `lib/worker-loop.ts:411` schreibt weiterhin bedingungslos `setPauseUntil(...)`, der Test prüft weiterhin nur, dass nie `null` geschrieben wurde.
- **`lib/acceptance-criteria.ts` ist toter Code** — `grep -rl "acceptance-criteria"` über alle `.ts`/`.tsx` → **genau ein Treffer**, die eigene Testdatei.
- **Beim Timeout wandert die `.md` nach `failed/`** — AC 4 von req-036 unerfüllt. **`parkFailed` pusht fremde Commits** (`lib/execute-step.ts:816`), inklusive rotem Test-Gate.
- **Der `health-agent` vertraut seinem Netz vollständig** — `grep -c "TOKEN\|timingSafeEqual\|authoriz\|secret" agent/index.ts agent/routes.ts` → **0 und 0**.
- **`psql` in der Erlaubnisliste ist faktisch beliebige Befehlsausführung** — `lib/docker.ts:35`, `isAllowedCommand` prüft weiterhin nur `cmd[0]`.
- **Die Web-Prüfung wertet „konnte nicht geprüft werden" als Rot** (`lib/health-checks.ts:197-199`).
- **Geheimnisse sollen nach `deploy/*.env`** — `delivery/devops.md` nennt den Pfad weiterhin **5×**, der Deploy liest `$HOME/appbaua-env/{dev,prod}.env`, `grep -c deploy .gitignore` → **0**. Besonders bitter bleibt `APP_ORIGIN`: einzige Quelle für `rpId`/`expectedOrigin`, und fehlt sie, fällt die App still auf `http://localhost:3000` zurück.
- **Der PHP-Ausfallwächter wird faktisch ungetestet ausgeliefert** — in diesem Lauf wieder `watchdog/watchdog.test.ts (14 tests | 9 skipped)`.
- **Container laufen in UTC** — `grep -c TZ` → **0** in allen vier Compose-/Dockerfiles. Hübsch illustriert in diesem Diff: `1b54c81` trägt `+0200`, der Fix `37f9fe7` eine Stunde später laut Zeitstempel `+0000` — zwei Commits desselben Vorgangs in zwei Zeitzonen.
- **`WATCHDOG_TOKEN` fehlt in `SECRET_ENV_VARS`** (`grep -c WATCHDOG_TOKEN lib/redact.ts` → 0); „heute schon gelaufen" hängt am 500-Zeilen-Fenster; `NODE_ENV=production` leckt in Claudes Kindprozesse; Lost-Update-Race in allen Blob-Mutationen inkl. aller 19 Methoden des File-Auth-Stores; Auth-Bootstrap-TOCTOU; `diagnostics` ohne Produzenten; bug-021 `overflowX: "clip"`; `serviceBlockLocal` ungenutzt; `worker-work`-Volume wächst unbegrenzt; `next lint` deprecated.

---

## Kleinere Punkte

**Neu, aus dem heute gelesenen Code:**

- **`reportFileName` kann einen Bericht still überschreiben** (`lib/review-report.ts:61-70`). Der Name ist `datum-typ-repo-commit.md`, ohne Uhrzeit und ohne Zähler. Zwei Läufe desselben Typs am selben Tag auf demselben Commit schreiben dieselbe Datei — und `fileReport` schreibt, es prüft nicht. Nach Befund 1 ist das kein theoretischer Fall: Ein Stand, der sich nicht bewegt, erzeugt denselben Dateinamen, so lange er sich nicht bewegt.
- **`hasSecurityFindings` hängt an einem exakten Zauberwort** (`lib/security-report.ts:42-46`). Alles außer dem normalisierten `"Security-Check ok"` zählt als Fund. Antwortet ein Lauf „Keine Auffälligkeiten gefunden." oder nur „ok", entsteht ein Berichtsdatei ohne Befund; die Entscheidung „Datei ja/nein" liegt damit an einer Zeichenkette, die der Prompt und das Modell einhalten müssen. Ein strukturiertes Signal (erste Zeile, Marker) wäre robuster — oder, näher an der bestehenden Lösung, zusätzlich die kurze Allerklar-Antwort als Länge prüfen.
- **`isoDate` nimmt die Ortszeit des Containers** (`lib/review-report.ts:46-49`, `getFullYear`/`getMonth`/`getDate`). Da die Container in UTC laufen (siehe oben), trägt ein Bericht, der zwischen 00:00 und 02:00 deutscher Zeit entsteht, das Datum des Vortages. Dieser Lauf hier fällt um 04:12 UTC genau in dieses Fenster.
- **Der letzte abgelegte Bericht trägt zwei Vorspänne.** `delivery/reviews/2026-10-06-…md`: `reportContent` setzt den Vorspann (Zeilen 1-6), und darunter steht in Zeile 15-22 noch einer, in einen Codeblock gerahmt — weil die Antwort des Laufs selbst mit einem begann. Der Bericht soll keinen mitbringen; das Modul liefert ihn. (Dieser Bericht enthält deshalb keinen.)
- **`isBranchName` lässt `HEAD` durch** (`lib/dev-branch.ts:125-132`). `PLAIN_BRANCH` passt, die drei Ausschlüsse greifen nicht. Ein Zielrepo, dessen `## Environments`-Tabelle in der dev-Zeile `HEAD` stehen hat, führt zu `checkout -B HEAD origin/HEAD` — ein Name, den git für sich beansprucht. Unwahrscheinlich, aber der eine Name, den eine Prüfung „ist das ein Branchname?" kennen sollte.
- **`buildPreview` klont/fetcht jedes aktive Repo zweimal pro Durchgang** (`lib/worker-loop.ts:150`, `:296`) — doppelte Last und doppelter GitHub-Verkehr für eine Antwort, die sich zwischen Anfang und Ende eines Durchgangs nur dann ändert, wenn wirklich etwas lief. Bei `succeeded === 0 && logged === 0` ist der zweite Aufruf nachweisbar überflüssig.

**Aus früheren Reviews, unverändert:**

- `newCode()` stimmt an drei Stellen nicht mit seinem Kommentar überein (hex statt base32, 20 statt 16 Zeichen, fünf statt vier Gruppen); `getOperator()` ist toter Code in der Produktion; `issueBackupCodes` kann kollidierende IDs erzeugen; `rpId()` wirft bei fehlkonfiguriertem `APP_ORIGIN`; `redeemInvitation` gibt drei unterscheidbare Fehler zurück, wo der Kommentar Ununterscheidbarkeit behauptet; `secure` am Sitzungs-Cookie hängt an `NODE_ENV` statt am Origin.
- `killAllProcessTrees` räumt `liveGroups` nicht leer; Exit-Code 0 auf SIGTERM statt 143; der bug-023-Prüfstand kann selbst eine Waise hinterlassen; seine 300-ms-Fristen bleiben auf dem Beelink knapp; `opts.killGraceMs` hat außerhalb der Tests keinen Aufrufer.
- Eine 6-Stunden-Pause kostet ~1.080 Weckvorgänge; ein dauerhaft ausfallender Store blendet den Hauptschalter mit aus; die 20-Sekunden-Lücke der Anzeige bleibt.
- `RunLog.tsx` `load()` ohne Fehlerbehandlung (`loading` bleibt `true`); `runRound` listet Container je Repo statt je Runde; `/neustart`-Rückfrage verfällt nie; Entwarnung ohne vorherige Meldung; Prompt-Injection aus fremden Logs; `flock` fehlt im PHP-Wächter; `check.php` trägt die Kennung in die Zugriffslogs.
- Kommentare zum `health-agent` („genau vier Aufrufe", „kein Netzwerk nach außen") unzutreffend; pg-store-Retention bei jedem Insert; `sampleCache` racy; `delivery/health.md:46` sagt weiterhin „bis zu einer Stunde je Paket", seit `ac2c9b6` sind es zwei.

---

## Was gut ist

**Der bug-024-Fix ist inhaltlich der beste Commit, den dieses Repo seit Wochen gesehen hat** — und das soll vor der Kritik an seinem Test stehen. Neun Pakete, drei Gruppen, jede Gruppe mit ihrem Grund im Dockerfile, und zwar mit dem *echten* Grund: „Alpine is musl, not glibc" erklärt, warum fünf Pakete zusammengehören, und PEP 668 plus „der Worker läuft nicht als root" erklärt, warum `py3-pip` allein nichts nützt und der Weg eine venv je Repo ist. Dieses Wissen steht jetzt dort, wo der nächste Lauf darüber stolpert, statt dass es ein zweites Mal erarbeitet werden muss. Das ist genau der Umgang mit Kommentaren, der diese Codebasis auszeichnet.

**Noch besser ist, was *nicht* hineingekommen ist.** `ffmpeg`, `imagemagick`, `sqlite3`, `jq` waren als fehlend gemessen und sind draußen geblieben, mit Begründung, und ein Test hält sie draußen. Ein Bugreport, der elf fehlende Werkzeuge auflistet, lädt dazu ein, alle elf nachzuwerfen; hier hat jemand zwischen „gemessen fehlend" und „nachweislich gebraucht" unterschieden. Dieselbe Disziplin steckt im Abschnitt „Was NICHT die Ursache ist" der Bugdatei: Das Test-Gate wurde ausgemessen (19 s, 10 s, unter 5 % der Laufzeit) und ausdrücklich freigesprochen, damit es niemand ein zweites Mal untersucht. Eine ausgeschlossene Ursache mit Zahlen dahinter ist genauso wertvoll wie die gefundene.

**`lib/dev-branch.ts`**, heute zum ersten Mal gelesen, ist das sauberste Modul dieses Repos. Es macht aus einer Markdown-Tabelle in einem *fremden* Repo einen maschinellen Vertrag und behandelt jeden Weg, auf dem das schiefgehen kann: Die Spalte wird am Header gefunden statt an der Position geraten, `<TODO: branch>` wird als „sagt nichts" erkannt und nicht als Branch namens TODO, `feature/*` wird als Konvention statt als Name verstanden und führt ausdrücklich dazu, dass der Worker *nichts* anlegt, und ein lokaler Branch, den das Remote nicht kennt, gilt als Rückstand eines früheren Laufs statt als Absicht des Repos. Drei Sätze Kommentar erklären, warum dieselbe Zeile auch die Doku-Screenshots speist — ein Vertrag, zwei Leser, ein Parser. Und die Begründung ganz oben ist die richtige: „So the convention is no longer this worker's. It belongs to the target repo."

**`lib/preview.ts`** hat trotz Befund 3 die richtige Grundentscheidung getroffen und ausgeschrieben: nicht bei jedem Seitenaufruf klonen, sondern nach jedem Durchgang einmal — mit der Begründung, warum ein Browser-Poll der falsche Auslöser wäre. Dass `buildPreview` nie wirft und ein unerreichbares Repo einfach keine Zeile beiträgt, ist für eine Anzeige genau richtig gewichtet. Der Fehler sitzt eine Ebene tiefer, in der mitbenutzten Funktion, nicht in diesem Modul.

Im Übrigen unverändert solide, und diesmal live bestätigt: 1187 Tests ohne Docker, ohne Telegram und ohne KI-Anbieter in 20 Sekunden; `pushFailed()` wird konsequent geprüft; `runTestGate` läuft vor jedem Move nach `done/`; SQL ist überall parametrisiert; `consumeChallenge` liest und löscht in einer Transaktion; `GIT_TERMINAL_PROMPT: "0"` und die Übergabe des Tokens als Einweg-Config statt in der URL bleiben richtig gemacht. Und der neue Test hält nebenbei fest, was frühere Bugs erkämpft haben — `bash` aus bug-016, Chromium samt Schriften aus req-017 —, damit es niemand beim nächsten Aufräumen wieder verliert. Das ist der richtige Instinkt am richtigen Ort.

---

**Empfehlung:**

**Befund 1 zuerst, vor jedem Codefix in diesem Bericht.** Nicht weil er der schwerste Einzelfehler ist — das ist Befund 4 —, sondern weil er jeden anderen Fix wertlos macht. Was auf `dev` liegt, läuft nicht. Drei Bugfixes aus fünf Wochen Arbeit, darunter die Speicherlecks aus bug-023 und die Werkzeuge aus bug-024, sitzen in einem Branch, den die Maschine nicht ausführt, und der Rückstand ist nirgends ablesbar. Der nächste Schritt ist klein und ausdrücklich erlaubt: **den PR von `dev` nach `main` öffnen** (`delivery/devops.md:176` — „Der Worker öffnet ihn höchstens"); gemerged wird er vom Nutzer, nach Abnahme auf der dev-URL. Dass heute niemand diesen PR öffnet, ist die eine fehlende Zeile im ganzen Verfahren. Danach, gleich wichtig: eine Anzeige, die den laufenden Stand gegen `origin/dev` stellt — ohne sie wiederholt sich das in sechs Wochen, und niemand wird es merken.

**Dann Befund 2**, weil er derselbe Fehler auf der Prüfseite ist. Drei Zeilen im Deploy-Workflow, die nach `up -d --build` im Container `command -v` für die neun Werkzeuge fahren, und bug-024 kann nicht mehr grün und gleichzeitig kaputt sein. Solange die einzige Zusicherung ein String in einer Datei ist, prüft dieses Repo seine Absichten und nicht seinen Betrieb.

**Dann Befund 4** — die eine Zeile im Auth-Stack (`finishRegistration` gibt die verifizierte Credential-ID zurück, `finishRegistrationAndSignIn` benutzt sie statt `response.id`). Zweite Woche, unverändert, und davor steht allein, dass ein öffentlich gedachter Bezeichner zufällig nirgends herausgegeben wird. **Dann Befund 5** (`countUsers()` → „hat schon jemand ein Credential", an beiden Stellen) — und zwar bevor jemand prod neu aufsetzt, denn genau das steht nach Befund 1 als Nächstes an.

**Befund 3 ist der teuerste Einzelposten im Worker-Teil** und zugleich der überraschendste: Die Vorschau vernichtet die geretteten Etappen im selben Durchgang, in dem sie gerettet wurden. Zwei Commits und ein Volume sind in diese Rettung gegangen; sie hat nie etwas gebracht, und jetzt ist nachweisbar, warum. Die Vorschau braucht keinen `reset --hard` — sie will nur in `ready/` nachsehen.

**Befund 12** bleibt der billigste Posten überhaupt: `npm audit fix` plus `images: { unoptimized: true }`, eine Viertelstunde, vierte Woche im Rezept. **Befund 10** (req-039 anlegen oder die Verweise streichen) kostet zehn Minuten und beseitigt die Begründung, auf der ein Test heute vier Pakete draußen hält. **Befund 7** bleibt der Einzeiler mit der größten Hebelwirkung im Laufzeitverhalten — und er wird nach der Promotion wichtiger, nicht unwichtiger: Dann läuft der Prozessbaum-Schutz, und ein `ENOMEM`, das weiterhin als Netzstörung gilt, legt immer noch dreimal den Pass still.

**Zusammenfassung:** Erster Durchgang seit vier Wochen mit echtem Code im Diff — bug-024 bringt neun Systemwerkzeuge in die `Dockerfile.worker`, gut begründet, mit einem Test und mit erfreulicher Zurückhaltung bei dem, was nicht belegt war. Ich habe diesen Fix dort geprüft, wo er wirken soll, nämlich im laufenden Container, und dabei den schwersten Befund dieses Berichts gefunden: **der Worker, der arbeitet, läuft auf `main` — `8e5dab4` vom 11. September, 19 Commits und 32 Tage hinter `dev`.** Belegt über Blob-Hashes (`/app/lib/workspace.ts` und `/app/lib/worker-loop.ts` sind bitgenau `origin/main`), über die apk-Schicht vom 30. Juli und über 5,0 Tage Container-Laufzeit. Folge: `perl`, `exiftool`, `python3`, `make`, `gcc`, `g++` und sechs weitere fehlen **heute** genau so wie am Tag der Bugmeldung; `installProcessTreeCleanup` kommt im laufenden Code **null mal** vor, der bug-023-Ausfall ist also unverändert möglich; bug-022 ebenso. Nichts im Repo öffnet den erlaubten dev→main-PR, und nichts zeigt den Rückstand an. Dazu, als Verfahrensbefund: bug-024s Test prüft den Text der `apk add`-Zeile, nicht das Image — acht grüne Tests, geschlossene Bugdatei, lebendiger Bug —, und sein Paket-Parser lässt die `--virtual`/`apk del`-Redewendung durch, mit einem Prüfstand belegt, der grün lief und wieder gelöscht ist. Neu außerdem: die Vorschau (`lib/preview.ts`, in elf Berichten nie gelesen) ruft zweimal pro Durchgang `prepareRepoOnConvention` und vernichtet damit die geretteten Etappen im selben Durchgang, in dem `keepStages` sie rettet; die Werkzeugkette fehlt `linux-headers`; der venv-Weg hängt ungeprüft am `.gitignore` fremder Repos; `req-039` ist an vier Stellen die „dauerhafte Antwort" und existiert nicht; `lib/github-repos.ts` schluckt 401/403 und kappt still bei 500 Repos. Alle 27 Vorbefunde am heutigen Code nachgeprüft: **alle 27 unverändert offen**, darunter zum zehnten Mal die fehlende Authentifizierung (heute gezählt: 3 von 33 Routen) und zum vierten Mal 1 kritisch + 4 high in `npm audit` mit vollständig vorliegendem Rezept. Quality Gate live und grün: 1187/1187 Tests (+9 übersprungen, 77 Dateien, genau die 8 neuen des Diffs), Typecheck sauber, Lint unverändert 5 False Positives. Ich habe nichts committet und nichts gepusht; der Arbeitsbaum ist sauber.
