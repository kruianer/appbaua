---
id: req-041
title: Layout für iPad und Laptop
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-17
changes: req-039
---

# Goal (Why)

Ich arbeite nicht nur am Telefon. Auf dem iPad und am Laptop sieht die
App heute aus wie auf dem iPhone — eine schmale Spalte mitten auf einem
großen Bildschirm, mit einer Leiste am unteren Rand, weit weg vom Blick.
Die vorhandene Breite soll genutzt werden.

# Function (What)

Ab einer Fensterbreite von 744px wandert die Navigation von unten an
den linken Rand. Die untere Leiste entfällt dort; am iPhone bleibt sie
unverändert wie in req-039.

In der Seitenleiste stehen alle Menüpunkte oben, nur Einstellungen am
unteren Ende. "Mehr" gibt es dort nicht — Zustand und Tasks haben
eigene Einträge.

Die Seitenleiste lässt sich von Hand zusammenklappen und wieder
aufklappen. Eingeklappt zeigt sie nur die Symbole, aufgeklappt Symbol
und Text. Die Fensterbreite gibt nur den Anfangszustand vor: bis 1023px
eingeklappt, ab 1024px aufgeklappt.

Der Chat wird zweispaltig: links die Repos, rechts das Gespräch des
gewählten Repos. Die Repo-Auswahl aus req-040 wird damit zur ständig
sichtbaren Liste.

# GUI

- Mockup: `delivery/design/design 2.0/Responsive.html`
  (Tokens in `styles.css`, unverändert aus `design 1.0`)
- Binding: so weit wie möglich ans Design halten — Aufbau, Abstände,
  Verhalten. Die Geräterahmen in der Datei sind reine Darstellung und
  gehören nicht in die App.

# Acceptance Criteria

- [x] Given ich öffne die App in einem 1280px breiten Fenster, when die
      Ansicht erscheint, then steht die Navigation am linken Rand.
- [x] Given ich öffne die App in einem 1280px breiten Fenster, when ich
      den unteren Rand ansehe, then gibt es dort KEINE Leiste.
- [x] Given ich öffne die App in einem 390px breiten Fenster, when die
      Ansicht erscheint, then steht die Leiste wie bisher unten und
      links ist keine Seitenleiste.
- [x] Given ich öffne die App in einem 1280px breiten Fenster, when ich
      die Seitenleiste von oben nach unten lese, then lauten die
      Einträge "Aktivität", "Verlauf", "Chat", "Repos", "Zustand",
      "Tasks" und zuletzt "Einstellungen".
- [x] Given ich bin in einem 1280px breiten Fenster, when ich die
      Seitenleiste ansehe, then gibt es KEINEN Eintrag "Mehr".
- [x] Given die Seitenleiste ist aufgeklappt, when ich auf den
      Einklapp-Knopf tippe, then zeigt sie nur noch Symbole ohne Text.
- [x] Given die Seitenleiste ist eingeklappt, when ich auf den
      Aufklapp-Knopf tippe, then zeigt sie wieder Symbol und Text.
- [x] Given ich öffne die App in einem 1280px breiten Fenster, when die
      Ansicht zum ersten Mal erscheint, then ist die Seitenleiste
      aufgeklappt.
- [x] Given ich öffne die App in einem 800px breiten Fenster, when die
      Ansicht zum ersten Mal erscheint, then ist die Seitenleiste
      eingeklappt.
- [x] Given ich habe die Seitenleiste eingeklappt, when ich die App
      schließe und neu öffne, then ist sie weiterhin eingeklappt.
- [ ] Given ich bin im Chat in einem 1280px breiten Fenster, when die
      Ansicht erscheint, then steht links eine Liste aller Repos und
      rechts das Gespräch des gewählten Repos.
- [ ] Given ich bin im Chat in einem 1280px breiten Fenster, when ich
      links auf "Wellarita" tippe, then zeigt die rechte Spalte das
      Gespräch von Wellarita.
- [ ] Given ich bin im Chat in einem 1280px breiten Fenster, when ich
      eine lange Antwort lese, then reicht keine Textzeile über die
      volle Fensterbreite.
- [ ] Given ich ziehe das Fenster von 1280px auf 390px schmal, when ich
      hinsehe, then ist die Navigation unten und der Chat einspaltig.

# Constraints

- Die Maße und der Aufbau stehen im Mockup. Abweichungen nur, wo es
  dort keine Aussage gibt.

# Out of Scope

- Wie die übrigen Menüpunkte (Repos, Zustand, Tasks, Einstellungen) die
  zweite Spalte nutzen. Diese Detailseiten sind bewusst noch nicht
  entworfen — sie bleiben auf den großen Geräten einspaltig, bis dafür
  ein eigenes Requirement vorliegt.
- Jede Änderung an der unteren Leiste des iPhones (req-039).
- Jede Änderung am Verhalten des Chats selbst (req-040) — hier ändert
  sich allein, wie er angeordnet ist.
- Eine Möglichkeit, die Breite der Seitenleiste oder der Repo-Spalte zu
  ziehen.
- Ein eigenes Layout für Zwischengrößen über 1024px hinaus.
