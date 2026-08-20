---
titel: "Worker-Herzschlag — Hänger vom Leerlauf unterscheiden"
datum: 2026-08-20
---

## Problem/Nutzen

Der Worker läuft unbeaufsichtigt auf einem eigenen Rechner. Die App
kennt heute zwei sichtbare Zustände: "aktiv" (ein Schritt läuft, req-008)
und "Leerlauf" — mit Begründung, seit req-021/req-022 sogar mit Grund und
Vorschau auf das Nächste. Was in keinem dieser Zustände vorkommt, ist der
Fall, dass der Worker-Prozess selbst abgestürzt ist, sich aufgehängt hat
oder sein Container nicht mehr startet: Von außen sieht das exakt so aus
wie planmäßiger Leerlauf — die Aktivitätskarte zeigt weiterhin ruhig
"Leerlauf — nächstes Zeitfenster ab HH:MM", nur dass dieses Zeitfenster
nie mehr eintritt, weil niemand mehr da ist, der es auswertet.

req-029 fängt den Fall ab, dass ein einzelner Claude-Lauf an einem
Rate-Limit scheitert — das ist ein erkannter, benannter Zustand. Ein
hängender oder toter Worker-Prozess ist der unbenannte Zwilling davon:
er erzeugt gar keine Fehlermeldung, weil er gar nichts mehr tut. Genau
dieses Muster — ein Ausfall, der wie der Normalzustand aussieht — ist
laut [Schritt-Beleg-Idee](schritt-beleg-quality-gate-nachweis.md) und
[Backup-Idee](backup-mit-restore-drill-nachweis.md) bereits als der
teuerste Fehlerfall des Systems identifiziert; hier tritt er eine Ebene
tiefer auf, nicht bei einem Quality Gate oder einem Backup, sondern beim
Worker-Prozess selbst.

Nutzen:

- **Rock-solid Qualität** — der teuerste stille Ausfall (Worker tot, App
  merkt es nicht) bekommt einen eigenen, erkennbaren Zustand statt sich
  hinter "Leerlauf" zu verstecken.
- **Nachvollziehbarkeit** — der Nutzer kann jederzeit unterscheiden:
  "läuft gerade nichts, weil planmäßig nichts ansteht" vs. "der Worker
  meldet sich seit X nicht mehr, obwohl er sollte".
- **Ansprechende Visualisierung** — ein Puls statt eines Status-Texts:
  ein kleiner, sich regelmäßig aktualisierender Herzschlag-Indikator
  macht "der Worker lebt" unmittelbar sichtbar, statt es aus einem
  Zeitstempel ableiten zu müssen.

## Skizze

**Kern:** Der Worker-Prozess schreibt bei jedem Schleifendurchlauf —
unabhängig davon, ob er gerade einen Schritt ausführt, im Leerlauf wartet
oder in einer Rate-Limit-Pause (req-029) steckt — einen Zeitstempel
("zuletzt lebendig gesehen um …") in die Datenbank. Das ist kein neuer
Task-Typ und keine neue Entscheidung, nur ein Lebenszeichen der ohnehin
laufenden Schleife.

Die App vergleicht diesen Zeitstempel gegen ein erwartetes Intervall
(die Schleifenfrequenz, ggf. plus die bekannte Rate-Limit-Pause aus
req-029, damit die Pause selbst keinen Fehlalarm auslöst). Bleibt der
Zeitstempel deutlich länger stehen als plausibel, kippt die Anzeige von
"lebt" auf einen eigenen, unübersehbaren dritten Zustand.

**Darstellung — Puls-Indikator auf der Status-/Aktivitätskarte:**

```
● Worker          ⟳ zuletzt lebendig: vor 12 Sekunden
  Leerlauf — nächstes Zeitfenster (Doku) ab 02:00
```

Kippt es:

```
✗ Worker antwortet nicht mehr
  letztes Lebenszeichen: 2026-08-20, 03:47 Uhr (vor 6 Std 12 Min)
```

Der Punkt links kann als echter, sanft pulsierender Indikator animiert
sein, solange der Worker lebt (Timer im Frontend, kein zusätzliches
Backend-Polling nötig) — das macht "es tut sich was" fühlbar statt nur
lesbar, im Sinne der "ausgefallenen" Visualisierungs-Freiheit der
Ideen-Richtung.

**Ehrlichkeits-Regel:** Der dritte Zustand wird nie stillschweigend zu
"Leerlauf" geglättet, auch nicht nach einem Neustart der App — er bleibt
sichtbar, bis ein frisches Lebenszeichen eintrifft.

**Abgrenzung:** Reine Nachweis- und Sicht-Ebene auf Basis eines einzigen
zusätzlichen Zeitstempels. Kein Aufweichen des Human-Gates, keine
automatische Neustart-Logik für den Worker-Prozess (das wäre eine
Infrastruktur-Entscheidung, die vor Umsetzung separat zu bestätigen
wäre, nicht Teil dieser Idee), keine Änderung an der Auswahl- oder
Retry-Logik aus req-029. Schwellwert für "hängt" und genaue
Schreibfrequenz sind Umsetzungsdetails, vor der Umsetzung zu bestätigen.
