---
titel: "Schritt-Beleg — jeder Schritt weist sein Quality Gate nach"
datum: 2026-07-26
---

## Problem/Nutzen

Wenn der Worker einen Schritt beendet, steht im Verlauf eine Kurzmeldung
wie "req-012 abgearbeitet". Diese Meldung ist heute eine **Selbstauskunft
der KI**: Sie behauptet, fertig zu sein — und implizit, dass Tests, Lint
und Typecheck grün waren. Nachprüfen kann das von außen niemand. Die
Vision verlangt ausdrücklich "Quality Gates nie umgehen: Tests und
Reviews nicht überspringen oder rot durchwinken, um eine Aufgabe 'fertig'
zu melden" — genau diese Zusage ist derzeit die einzige Stelle im System,
die auf Vertrauen statt auf Nachweis beruht.

Für einen Worker, der nachts unbeaufsichtigt läuft und öffentlich
einsetzbar sein soll, ist das die teuerste offene Flanke. Der Mensch
sitzt am Ende vor der Promotion nach prod und muss entscheiden — mit
nichts in der Hand außer der Behauptung dessen, der die Arbeit gemacht
hat. Und der gefährlichste Fall ist nicht das rote Gate, sondern das
**gar nicht gelaufene**: ein Schritt, bei dem `npm test` nie ausgeführt
wurde, sieht im Verlauf exakt so aus wie einer mit 214 grünen Tests.

Nutzen:

- **Verlässlichkeit** — "grün behauptet" wird zu "grün belegt". Ein
  Schritt ohne Nachweis ist erkennbar ein Schritt ohne Nachweis.
- **Nachvollziehbarkeit** — pro Schritt ist sichtbar, was er angefasst
  hat und woran gemessen wurde, dass er in Ordnung ist.
- **Entscheidungsgrundlage am Human-Gate** — der Mensch geht mit Evidenz
  in die Abnahme statt mit Vertrauensvorschuss.
- **Frühwarnung** — ein Gate, das über Wochen nie lief oder chronisch
  gelb ist, fällt auf, bevor es in prod auffällt.

## Skizze

**Kern:** An jedem Schritt hängt ein **Beleg** — eine maschinell erfasste
Ergebniszeile pro Quality Gate aus [stack.md](../stack.md) (Test, Types,
Lint, Build), dazu der Fußabdruck der Änderung (Commit, Dateien, +/−).
Der Beleg entsteht **nicht** dadurch, dass die KI ihn formuliert, sondern
aus beobachteten Exit-Codes.

**Herkunft des Belegs (wichtig, weil die Umgebung eng ist):** Erste
Quelle ist der CI-Lauf zum gepushten Commit
([deploy.yml](../../.github/workflows/deploy.yml)) — eine vom Worker
unabhängige Instanz, was den Nachweis gerade wertvoll macht. Der Worker
holt nach dem Push die Conclusion der Jobs zu seinem Commit-SHA ab und
hängt sie an den Schritt. Wo Gates zusätzlich lokal ausführbar sind,
zählt das lokale Ergebnis als zweite Quelle. Ist beides nicht verfügbar,
lautet der Beleg **"nicht belegt"** — grau, nie grün.

**Darstellung 1 — Beleg-Karte im Verlauf:** aufklappbar unter dem
Verlaufseintrag, kompakt genug fürs Smartphone:

```
✓ Requirements × appbaua — req-013-…md            #a3876c5
  Tests   ✓ 214 grün / 0 rot        18 s   (CI)
  Types   ✓ keine Fehler             6 s   (CI)
  Lint    ▲ 3 Warnungen, 0 Fehler    4 s   (CI)
  Build   ✓                         41 s   (CI)
  Diff    6 Dateien   +182 / −37
```

**Darstellung 2 — Gate-Matrix pro Repo:** Zeilen = Gates, Spalten = die
letzten N Schritte, jede Zelle ein farbiger Punkt (grün / gelb / rot /
grau = nicht belegt). Das Muster erzählt mehr als jeder Einzeleintrag:
eine durchgehend graue Zeile heißt "dieses Gate läuft in Wahrheit nie",
ein Farbumschlag in einer Spalte zeigt den Schritt, ab dem es kippte.

**Darstellung 3 — Promotions-Ampel:** vor einer Promotion zeigt die App
gebündelt, ob **alle** Belege seit dem letzten prod-Stand grün sind, und
listet die Ausreißer namentlich auf. Reine Anzeige: Die Ampel gibt nichts
frei, sie informiert nur den, der freigibt.

**Ehrlichkeits-Regeln (der eigentliche Wert der Idee):**

- "Nicht ausgeführt" ist ein eigener, sichtbarer Zustand — er wird nie zu
  grün geglättet, auch nicht bei fehlender CI.
- Ein Gate, das für ein Repo nicht definiert ist, steht grau als "nicht
  definiert" da, statt lautlos zu fehlen.
- Rot bleibt rot: Ein Schritt mit rotem Gate darf sich nicht als Erfolg
  verbuchen; er endet wie ein Fehlschlag (Datei nach `failed/`, req-008).

**Abgrenzung:** Nachweis- und Sicht-Ebene auf Basis von Ergebnissen, die
ohnehin schon entstehen. Kein Aufweichen des Human-Gates — die Idee
liefert dem Menschen Belege, entscheidet aber nichts für ihn und löst
keine Promotion aus. Keine neue Testinfrastruktur, kein automatisches
Reparieren roter Gates, keine Änderung an der Auswahl-Logik des Workers.
Datenmodell-seitig braucht es Platz für den Beleg am Schritt; das wäre
vor der Umsetzung als Vorschlag zu bestätigen, nicht stillschweigend
vorauszusetzen.
