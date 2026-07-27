---
id: req-030
title: Repo-Zeile — zweite Zeile aufklappbar statt dauerhaft sichtbar
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-07-27
changes: req-012, req-028
---

# Goal (Why)

Die Repo-Liste ist unruhig geworden: Unter jedem Eintrag steht dauerhaft
eine zweite Zeile mit Modell-Auswahl und "Auf appbaua umstellen". Beides
brauche ich selten. Ich will die Liste kompakt sehen und die Details nur
dann, wenn ich sie brauche — so wie es bei den Task-Typen schon ist.

# Function (What)

In der Repo-Verwaltung wird die zweite Zeile eines Repo-Eintrags
standardmäßig ausgeblendet und nur bei Bedarf aufgeklappt — nach dem
Vorbild der Task-Typen (req-002).

- **Eingeklappt (Standard):** Der Eintrag zeigt nur Position, Name, URL,
  den Aktiv-Schalter und den Entfernen-Button.
- **Aufklappen:** Ein Klick auf den Namens-/URL-Bereich des Repos klappt
  die zweite Zeile auf; ein erneuter Klick darauf klappt sie wieder zu.
- **Inhalt der zweiten Zeile:** die Modell-Auswahl (req-028), der Button
  "Auf appbaua umstellen" (req-012) und dessen Ergebnismeldung.
- **Nur einer gleichzeitig:** Öffnet man ein zweites Repo, klappt das
  zuvor geöffnete zu.
- **Umsortieren klappt zu:** Wird die Reihenfolge per Drag & Drop
  geändert, wird ein offener Bereich geschlossen (wie bei den
  Task-Typen).
- **Während einer Umstellung bleibt offen:** Läuft gerade eine
  Umstellung ("Wird umgestellt …") oder steht deren Ergebnismeldung da,
  klappt nichts von selbst zu — nur der Nutzer (oder das Umsortieren)
  schließt den Bereich.

Das Auf-/Zuklappen hat NICHTS mit dem Verschieben zu tun: Der Drag-Griff,
der Aktiv-Schalter und der Entfernen-Button bleiben eigenständig
bedienbar und lösen kein Auf- oder Zuklappen aus.

# Acceptance Criteria

- [ ] Given die Repo-Liste enthält das Repo "appbaua", when ich die Liste
  öffne, then sehe ich weder die Modell-Auswahl noch den Button "Auf
  appbaua umstellen" für diesen Eintrag.
- [ ] Given der Eintrag "appbaua" ist eingeklappt, when ich auf seinen
  Namen klicke, then erscheinen die Modell-Auswahl und der Button "Auf
  appbaua umstellen".
- [ ] Given der Eintrag "appbaua" ist aufgeklappt, when ich erneut auf
  seinen Namen klicke, then sind Modell-Auswahl und Button wieder
  ausgeblendet.
- [ ] Given der Eintrag "appbaua" ist aufgeklappt, when ich auf den Namen
  eines anderen Repos klicke, then ist nur noch dieses andere Repo
  aufgeklappt und "appbaua" wieder zu.
- [ ] Given ein aufgeklapptes Repo, when ich die Reihenfolge per Drag &
  Drop ändere, then ist der aufgeklappte Bereich geschlossen.
- [ ] Given ein aufgeklapptes Repo, when ich seinen Aktiv-Schalter
  betätige, then ändert sich nur der Aktiv-Zustand und der Bereich bleibt
  aufgeklappt (der Schalter klappt NICHT zu).
- [ ] Given ich habe "Auf appbaua umstellen" ausgelöst und die
  Ergebnismeldung erscheint, when ich nichts weiter tue, then bleibt der
  Bereich offen und die Meldung lesbar.

# Out of Scope

- Änderung an dem, WAS die Modell-Auswahl oder "Auf appbaua umstellen"
  tun (req-028 bzw. req-012 bleiben inhaltlich unverändert).
- Aufklappbare Details bei den Task-Typen — die verhalten sich bereits so
  und werden nicht angefasst.
- Ein Merken des Auf-/Zuklapp-Zustands über einen Seiten-Neuladen hinweg.
