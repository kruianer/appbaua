---
id: req-022
title: Aktivitätsseite — kleineres Log und Vorschau "Nächste Aktivitäten"
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
changes: req-008
---

# Goal (Why)

Die Live-Ausgabe auf der Aktivitätsseite interessiert mich inhaltlich
kaum — ich will nur sehen, DASS etwas passiert. Der so gewonnene Platz
soll für eine Vorschau genutzt werden, die mir zeigt, was der Worker als
Nächstes tun wird und wann, damit ich seine Planung nachvollziehen und
bei Bedarf eingreifen kann.

# Function (What)

Zwei Änderungen auf der Aktivitätsseite:

1. **Kleineres Live-Ausgabe-Feld:** Das mitlaufende Ausgabe-Feld (die
   letzten Zeilen von Claude, req-008) wird etwa halb so hoch wie bisher.
   Es zeigt weiterhin die laufende Ausgabe, nimmt aber nur noch etwa den
   halben vertikalen Platz ein.

2. **Vorschau "Nächste Aktivitäten":** Unterhalb der Dashboard-Kacheln
   entsteht eine Liste, die bei jedem Durchlauf zeigt, was der Worker als
   Nächstes tun wird. Der Worker grast dafür alle aktiven Repos × die
   geplanten Task-Typen ab und listet sie in Prioritäts-Reihenfolge
   (Task-Typ-Prio außen, Repo-Prio innen — dieselbe Reihenfolge, in der
   er tatsächlich arbeitet).

   Jede Zeile zeigt:
   - Repo × Task-Typ,
   - den .md-Dateinamen bei datei-getriebenen Typen (Bugs, Requirements),
     bzw. "wiederkehrende Aufgabe" bei wiederkehrenden Typen (Code-Review,
     Ideen, Security, Doku),
   - den frühesten Termin, zu dem der Worker das voraussichtlich macht.

   Frühester Termin:
   - Bei Task-Typen auf "immer" (kein Zeitfenster): eine relative Angabe
     entlang der Warteschlange statt einer erfundenen Uhrzeit — der erste
     anstehende Eintrag "als nächstes", die folgenden "danach" bzw. "in
     der Warteschlange".
   - Bei Task-Typen mit Zeitfenster: der nächste Zeitpunkt, zu dem das
     Zeitfenster wieder greift (Datum/Uhrzeit).

   Von den wiederkehrenden Typen wird pro Typ nur der jeweils EINE nächste
   Lauf gezeigt, nicht mehrere künftige.

   Es werden alle geplanten Einträge gezeigt (keine Obergrenze). Steht
   gar nichts an (kein Repo aktiv oder alle Zeitfenster fern), zeigt die
   Liste den Hinweis "Nichts geplant".

# Acceptance Criteria

- [ ] Given ich öffne die Aktivitätsseite und ein Schritt läuft mit
  Live-Ausgabe, when ich das Ausgabe-Feld betrachte, then ist es etwa
  halb so hoch wie zuvor und zeigt weiterhin die laufende Ausgabe.
- [ ] Given es sind aktive Repos und geplante Task-Typen vorhanden, when
  ich die Aktivitätsseite ansehe, then sehe ich unter den Kacheln eine
  Liste "Nächste Aktivitäten" in Prioritäts-Reihenfolge.
- [ ] Given eine Vorschau-Zeile für "Requirements × appbaua" mit der
  wartenden Datei "req-030-beispiel.md", when ich sie ansehe, then zeigt
  sie "req-030-beispiel.md" als .md-Angabe.
- [ ] Given eine Vorschau-Zeile für einen wiederkehrenden Typ
  (Code-Review), when ich sie ansehe, then steht dort "wiederkehrende
  Aufgabe" statt eines Dateinamens.
- [ ] Given ein Task-Typ steht auf "immer" und ist der erste in der
  Reihenfolge, when ich seine Vorschau-Zeile ansehe, then zeigt der
  Termin "als nächstes" (keine erfundene Uhrzeit).
- [ ] Given ein wiederkehrender Task-Typ hat ein Zeitfenster, das erst
  morgen früh greift, when ich seine Vorschau-Zeile ansehe, then zeigt
  der Termin den nächsten Zeitpunkt, zu dem das Fenster greift.
- [ ] Given ein wiederkehrender Task-Typ mit Zeitfenster, when ich die
  Vorschau ansehe, then erscheint dafür nur EIN Eintrag (der jeweils
  nächste Lauf), nicht mehrere künftige.
- [ ] Given kein Repo ist aktiv bzw. nichts steht an, when ich die
  Vorschau ansehe, then zeigt sie "Nichts geplant".

# Out of Scope

- Eine Begründung, WARUM ein Schritt (nicht) läuft, über die reine
  Reihenfolge/Termin-Anzeige hinaus (die "Warum jetzt das?"-Idee bleibt
  ein separater, größerer Vorschlag).
- Änderung der tatsächlichen Scheduling-Logik, der Prioritäten oder der
  Zeitfenster — die Vorschau macht das bestehende Verhalten nur sichtbar.
- Ein Tagesband/Zeitleisten-Diagramm.
- Verlauf-Tab und Verlaufs-Einträge (dieses Requirement betrifft die
  Aktivitätsseite).
