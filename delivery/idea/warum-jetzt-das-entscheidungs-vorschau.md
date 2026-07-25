---
titel: "Warum jetzt das? — Entscheidungs-Vorschau mit Begründung"
datum: 2026-07-25
---

## Problem/Nutzen

Die App zeigt heute sehr gut, **was** der Worker gerade tut (Status-Karte
und Live-Ausgabe, req-005/req-008) und **was er getan hat** (Verlauf,
req-004). Was komplett fehlt, ist das **Warum**: Wenn der Worker um 03:12
"Code-Review × repo-b" startet, ist von außen nicht erkennbar, warum
nicht "Bugs × repo-a" — lag es an der Repo-Reihenfolge, war repo-a
inaktiv, gab es dort keine ready-Dateien, oder lag der Task-Typ außerhalb
seines Zeitfensters? Und genauso wenig ist erkennbar, was als **Nächstes**
kommt.

Genau dieses Loch ist der Punkt, an dem Vertrauen kippt. Sieht der
Betreiber morgens einen Lauf, den er nicht erwartet hat, muss er heute
Konfiguration, Zeitfenster und Ordnerinhalte im Kopf gegeneinander halten,
um zu rekonstruieren, ob der Worker richtig entschieden hat. Für einen
Worker, der unbeaufsichtigt auf einem eigenen Rechner läuft und
öffentlich einsetzbar sein soll, ist das die teuerste Art von
Intransparenz: Das Verhalten ist korrekt, wirkt aber willkürlich.

Nutzen:

- **Nachvollziehbarkeit** — jede Auswahl wird als Entscheidung mit
  sichtbaren Gründen lesbar, statt als Ergebnis einer Blackbox.
- **Verlässlichkeit** — Fehlkonfigurationen (Repo versehentlich inaktiv,
  Zeitfenster zu eng, ready-Ordner leer) fallen sofort auf, statt sich
  als "der Worker macht nichts" zu tarnen. Das ist der häufigste stille
  Ausfall dieses Systems.
- **Planbarkeit** — der Betreiber sieht vorab, was ansteht, und kann
  gezielt eingreifen (Prio ändern, Repo aktivieren), bevor eine Nacht
  verstreicht.

## Skizze

**Kern:** Die Auswahl-Logik des Workers liefert bei jedem Durchlauf nicht
nur den Gewinner-Schritt, sondern eine **bewertete Kandidatenliste** —
jedes Paar Repo × Task-Typ mit Ergebnis und Grund. Genau die Prüfungen,
die die Auswahl ohnehin schon durchläuft (Hauptschalter, Repo aktiv,
Repo-Prio, Task-Typ aktiv, Zeitfenster, vorhandene ready-Dateien), werden
als Entscheidungs-Spur festgehalten statt verworfen. Es ist bewusst
**keine neue, zweite Logik** — nur das Sichtbarmachen der bestehenden.

**Darstellung 1 — "Warum jetzt das?" (Aktivität-Tab):** Unter der
Status-Karte ein aufklappbarer Bereich, der die Kandidaten in
Prio-Reihenfolge als kompakte Zeilen zeigt, jeweils mit Ampel-Punkt und
Kurzgrund:

```
▸ Warum jetzt das?
  ✓ Bugs × appbaua          gewählt — 1 Datei in ready/
  – Bugs × repo-b           übersprungen — repo-b inaktiv
  – Requirements × appbaua  übersprungen — ready/ ist leer
  – Code-Review × appbaua   wartet — Zeitfenster erst ab 02:00
```

Damit ist in einem Blick beantwortet, warum der Gewinner gewonnen hat
*und* warum jeder andere nicht.

**Darstellung 2 — Tagesband:** Ein schmales, horizontales Zeitband über
24 Stunden, das die Zeitfenster der Task-Typen als farbige Segmente zeigt,
darauf die tatsächlich gelaufenen Schritte als Marker und die aktuelle
Uhrzeit als Linie. So wird auf einen Blick sichtbar, dass z.B. P3–P5 nur
nachts liefen — und ob ein Zeitfenster praktisch nie greift.

**Darstellung 3 — Nächste Schritte:** Aus derselben Kandidatenliste
ergibt sich ohne Zusatzaufwand eine kurze Vorschau ("als Nächstes
voraussichtlich: Requirements × repo-b"), klar als *Prognose bei
unveränderter Lage* gekennzeichnet, nicht als Zusage.

**Aufbewahrung:** Die Entscheidungs-Spur hängt am jeweiligen Schritt und
bleibt im Verlauf abrufbar — auch Tage später ist damit rekonstruierbar,
warum in einer bestimmten Nacht nichts passiert ist. Für den häufigsten
Fall bekommt der Leerlauf-Zustand eine echte Begründung statt "Leerlauf —
nichts zu tun": z.B. "Leerlauf — keine offenen Dateien; nächstes
Zeitfenster (Doku) ab 02:00".

**Abgrenzung:** Reine Sicht-Ebene. Die Auswahl-Logik selbst, die
Repo-Prioritäten und die Zeitfenster bleiben unverändert; nichts an
dieser Idee verschiebt eine Entscheidung vom Menschen weg — im Gegenteil,
sie legt die Entscheidungen des Workers offen. Kein Eingriff in das
prod/main-Gate.
