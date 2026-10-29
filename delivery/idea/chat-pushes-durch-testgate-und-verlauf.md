---
titel: "Zweiter Schreiber auf dev — Chat-Pushes ohne Testgate und ohne Spur"
datum: 2026-10-29
---

## Problem/Nutzen

Seit req-040 gibt es zwei Wege, auf denen Code nach `dev` gelangt: den
nächtlichen Worker und den Chat, in dem Claude „Code liest und ändert,
Befehle und Tests ausführt, committet und pusht". Beide pushen nach
`dev`, und jeder dieser Pushes löst den dev-Deploy aus. Abgesichert ist
aber nur einer davon:

- **Das Testgate gilt nur für den Worker.** req-019/req-025 lassen den
  Worker erst dann „fertig" melden, wenn Tests, Lint und Typecheck
  nachweislich gelaufen sind (`lib/test-gate.ts`, aufgerufen aus
  `lib/execute-step.ts`). Der Chat-Pfad (`lib/chat-session-manager.ts`,
  `lib/chat-workspace.ts`) ruft das Gate nirgends auf. Ob vor einem
  Chat-Push getestet wurde, hängt allein davon ab, ob Claude im Gespräch
  daran denkt.
- **Im Verlauf tauchen Chat-Pushes nicht auf.** Verlauf, Aktivitätskarte
  und Zeitstrahl (req-004/-008/-051) zeigen nur Worker-Schritte. Bricht
  am Morgen etwas auf dev, sieht der Betreiber dort ausschließlich die
  Arbeit des Workers. Der Push aus dem Chat von gestern Abend, der
  vielleicht die Ursache ist, steht nur im `git log`.
- **Zwei Arbeitskopien, ein Branch.** Chat und Worker haben bewusst
  getrennte Arbeitskopien (req-040). Das schützt die Dateien, aber nicht
  `dev`: Pushen beide in dasselbe Repo, scheitert einer der Pushes
  (non-fast-forward), oder einer baut auf einem Stand auf, den er nie
  getestet hat. bug-040/bug-041 zeigen, dass genau diese Stelle schon
  zweimal gehakt hat.

Damit gibt es in der Pipeline einen zweiten Weg nach `dev`, der die
Quality-Zusage der Vision umgeht, ohne dass es irgendwo auffällt.
Absicht ist das nicht, der Chat ist nur später dazugekommen. Gerade
weil der Chat das Werkzeug des Betreibers selbst ist, liegt hier ein
großer Hebel: Der Mensch bekommt beim eigenen Arbeiten dieselbe
Absicherung, die er dem Worker auferlegt hat.

Nutzen:

- **Rock-solid Qualität:** Nach `dev` kommt nur, was das Gate passiert
  hat, egal ob es vom Worker oder aus dem Chat stammt.
- **Nachvollziehbarkeit:** „Was hat sich auf dev geändert und wer war
  das?" lässt sich an einer Stelle beantworten statt im `git log`.
- **Visualisierung:** Im Zeitstrahl erscheinen Chat-Pushes als eigene,
  farblich abgesetzte Spur neben den Worker-Schritten.

Das Human-Gate bleibt unberührt: Es geht nur um `dev`, nach `main`/prod
ändert sich nichts.

## Skizze

**1. Testgate vor jedem Chat-Push.** Wenn Claude im Chat pushen will,
läuft vorher dasselbe `lib/test-gate.ts` in der Chat-Arbeitskopie. Bei
Grün geht der Push durch. Bei Rot oder „nicht ausführbar"
(Unterscheidung aus req-025) wird nicht gepusht. Der Chat zeigt dann
eine Gate-Karte mit Ergebnis und Auszug, wie die Schritt-Anzeige aus
req-048/-049. Ein bewusstes „trotzdem pushen" ist möglich, wird aber als
solches markiert (siehe 3). Es gibt keine stille Umgehung, aber auch
keine Blockade für den Menschen, der es besser weiß.

Offene Entscheidung, die das Requirement klären muss: Erzwingt man das
technisch, etwa über einen pre-push-Hook in der Chat-Arbeitskopie, oder
reicht eine verbindliche Vorgabe im Chat-Systemprompt plus die
nachgelagerte Kontrolle aus Punkt 3? Empfehlung: der Hook, denn er ist
einfach, prüfbar und hängt nicht vom Modellverhalten ab.

**2. Push-Kollision erkennen statt erleiden.** Vor dem Push holt die
Chat-Arbeitskopie `dev` neu. Hat der Worker zwischenzeitlich gepusht,
wird zuerst rebased und das Gate auf dem neuen Stand erneut ausgeführt.
Scheitert der Rebase, sagt der Chat das klar („der Worker hat inzwischen
X nach dev gebracht, Konflikt in Datei Y") und pusht nicht. Umgekehrt
prüft der Worker vor seinem Push dasselbe. Das liefert den Ablauf aus
req-020 vermutlich schon weitgehend; das Requirement soll das
verifizieren und nicht neu bauen.

**3. Chat-Pushes im Verlauf.** Jeder Push aus dem Chat erzeugt einen
Verlaufseintrag mit Quelle „Chat", Repo, Commit-Bereich, Kurztitel aus
der Commit-Message, Gate-Ergebnis (grün / rot-übersteuert / nicht
ausführbar) und einem Link zurück in die Chat-Sitzung. Im Zeitstrahl
(req-051) bekommt der Chat eine eigene Spur. Am Morgen sieht man dann
z. B.: Worker bug-041 (grün) um 02:10, Chat-Push um 22:47 mit Gate
übersteuert.

**4. Kleine Kennzahl am Repo.** In der aufklappbaren Repo-Zeile
(req-030) steht: „Letzte 7 Tage: n Pushes nach dev, davon m aus dem
Chat, k ohne grünes Gate." Ist k > 0, wird das hervorgehoben. Die Zahl
ist kein Vorwurf, sie zeigt nur, wo dev-Qualität unbeobachtet
entstanden ist.

**Abgrenzung:**
- [Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md) macht den
  Gate-Nachweis des *Workers* überprüfbar. Diese Idee bringt das Gate
  erst einmal auf den *Chat*-Pfad, wo es heute fehlt.
- Die [Abnahme-Mappe](abnahme-mappe-vor-dem-human-gate.md) gruppiert, was
  zwischen dev und main liegt, nach Paketen. Chat-Pushes haben oft keine
  Paket-Kennung. Mit der Quelle „Chat" aus Punkt 3 könnte die Mappe sie
  später eigens ausweisen, statt sie als namenlose Commits zu zeigen.

**Bewusst nicht enthalten:** keine Einschränkung, *was* im Chat geändert
werden darf, keine Freigabe-Pflicht für Chat-Pushes und keine Änderung
am Weg nach `main`.
