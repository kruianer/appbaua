---
titel: "Verfügbarkeits-Verlauf statt nur der aktuellen Ampel"
datum: 2026-09-10
---

## Problem/Nutzen

Die Zustandsseite (req-032) zeigt je überwachter App eine Ampel und die
einzelnen Prüfungen mit **ihrem letzten Ergebnis und Zeitpunkt** — bewusst
als Momentaufnahme. Verlauf und Statistik über die Zeit stehen im
Requirement selbst ausdrücklich unter *Out of Scope*: "Verlauf und
Statistik der Ausfälle über die Zeit (Verfügbarkeit in Prozent,
Diagramme)". Das ist als Abgrenzung für req-032 richtig — aber die Lücke
bleibt seitdem offen: Wer heute wissen will, ob eine App gestern Nacht 20
Minuten oder 5 Stunden down war, oder ob eine Prüfung ständig knapp an
der Grenze flackert, hat dafür keine Quelle außer den einzelnen
Telegram-Nachrichten (req-033), die scrollend im Chat verschwinden.

Zwei Ausfälle, die auf der heutigen Zustandsseite identisch aussehen —
"Rot, zuletzt geprüft vor 3 Minuten" — können in Wahrheit grundverschieden
sein: der eine ist vor einer Minute neu aufgetreten, der andere zieht sich
seit Tagen als wiederkehrendes Muster durch, immer zur gleichen Uhrzeit.
Ohne Verlauf sind das zwei identische Kacheln.

Nutzen:

- **Rock-solid Qualität** — wiederkehrende Ausfallmuster (z. B. eine App,
  die jede Nacht um 3 Uhr kurz down geht) fallen auf, statt in
  Einzelmeldungen unterzugehen.
- **Nachvollziehbarkeit** — "wie zuverlässig lief App X in den letzten 7
  Tagen wirklich" bekommt eine Antwort, ohne Telegram-Verlauf oder
  Server-Logs zu durchsuchen.
- **Ansprechende Visualisierung** — genau die Diagramm-/Zeitleisten-Form,
  die req-032 selbst schon als wünschenswerte Erweiterung benennt, statt
  einer reinen Ampel.

## Skizze

**Kern:** Jede Prüfrunde, die req-032 ohnehin schon durchführt (Container,
Datenbank, Web, Zigbee, KI — im konfigurierten Abstand), schreibt ihr
Ergebnis zusätzlich als Zeitreihen-Eintrag fest, statt nur den letzten
Stand zu überschreiben. Kein neuer Prüfmechanismus, keine zusätzlichen
Aufrufe an die überwachten Apps — nur: das Ergebnis, das ohnehin entsteht,
wird nicht mehr verworfen, sobald die nächste Prüfrunde es ersetzt.

**Darstellung 1 — Verfügbarkeits-Balken je App (z. B. auf der
Zustandsseite unter der Ampel):**

```
LivingGardenTwin · letzte 7 Tage
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░▓▓▓▓▓▓▓  99,1 % verfügbar
                    └─ 12 Min. Ausfall, 04.09., 03:12–03:24 (Web)
```

Jedes rote Segment ist antippbar und zeigt Zeitraum, Dauer und
betroffene Prüfart — dieselben Informationen, die auch als
Telegram-Meldung (req-033) verschickt wurden, hier aber als
nachschlagbare Historie statt als flüchtiger Chat.

**Darstellung 2 — Ausfall-Liste je Prüfart:** eine kompakte Tabelle mit
Beginn, Ende, Dauer und Prüfart, sortiert nach Häufigkeit — damit ein
Muster wie "diese Prüfung fällt seit 2 Wochen jede Nacht kurz aus" beim
Lesen sofort auffällt, statt in Einzelmeldungen zu verschwinden.

**Zeitraum & Aufbewahrung:** ein rollierendes Fenster (z. B. 30 Tage),
Länge und genaue Aggregation (Rohdaten vs. Fünf-Minuten-Buckets) sind
Umsetzungsdetails.

**Ehrlichkeits-Regel:** Eine Prüfart ohne Ergebnis in einem Zeitraum
(z. B. weil sie erst später aktiviert oder zwischenzeitlich abgeschaltet
wurde, req-032) erscheint im Balken als eigener grauer Abschnitt "nicht
geprüft" — sie zählt nicht als grün und drückt die Verfügbarkeits-Prozent
nicht künstlich nach oben.

**Abgrenzung:** Reine Nachweis- und Sicht-Ebene auf Basis von
Prüfergebnissen, die req-032 ohnehin erzeugt. Keine neue Prüfart, kein
automatischer Neustart und keine Änderung an den bestehenden
Schwellwerten (zwei Fehlschläge in Folge, req-033) oder an der
Telegram-Benachrichtigung selbst. Betrifft ausschließlich fremde,
überwachte Apps — nicht den appbaua-Worker selbst (dafür siehe
[Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md)). Fensterlänge
und Speicherort der Zeitreihe sind vor der Umsetzung zu bestätigen, nicht
stillschweigend vorauszusetzen.
