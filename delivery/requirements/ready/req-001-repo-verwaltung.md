---
id: req-001
title: Repo-Liste im Webapp verwalten
app: appbaua
area: Worker-Steuerung
priority: high
created: 2026-07-24
---

# Goal (Why)

Ich will jederzeit festlegen und ändern können, welche Repos der Worker
bearbeitet und in welcher Reihenfolge, damit am Wichtigsten zuerst
gearbeitet wird und ich die Kontrolle über den Worker behalte.

# Function (What)

Eine Seite in der Webapp zeigt eine sortierbare Liste der Repos, die der
Worker bearbeiten soll. Jeder Eintrag zeigt einen Anzeigenamen und die
Git-URL. Ich kann:

- ein Repo hinzufügen: entweder aus einer Auswahlliste der über den
  hinterlegten GitHub-Token erreichbaren Repos wählen ODER eine Git-URL
  von Hand eingeben (Anzeigename optional),
- die Reihenfolge per Drag & Drop ändern — Position 1 = höchste
  Priorität,
- ein Repo aktiv/inaktiv schalten (inaktiv bleibt an seiner Position,
  wird aber ausgegraut dargestellt),
- ein Repo nach Bestätigung entfernen.

Beim Hinzufügen prüft die App über den zentral hinterlegten GitHub-Token,
ob das (private) Repo erreichbar ist. Ist es nicht erreichbar oder steht
die Git-URL bereits in der Liste, wird das Hinzufügen abgelehnt. Jede
Änderung wird sofort automatisch gespeichert und ist sofort wirksam.

# GUI

- Mockup: `delivery/design/design 1.0/` (Nocturne-Design für die
  Repo-Verwaltung; Haupt-Referenz `RepoNocturne.dc (1).html` und die
  Handoff-Beschreibung `README.md`; Design-Tokens in `styles (1).css`).
- Binding: so weit wie möglich ans Design halten (High-Fidelity,
  Aussehen, Abstände, Verhalten). Falls sich beim Umsetzen zeigt, dass
  eine Anforderung in diesem Req vom Design abweicht oder angepasst
  werden muss, ist es ok, die Anforderung an das Design anzupassen — das
  Design gibt im Zweifel den Ton an. Wo das Design schweigt, entscheidet
  die Umsetzung im Sinne des Designs.
- Zielgerät: primär Smartphone (Hochformat). Das Layout ist responsive
  aufgebaut, sodass es auf iPad und Laptop nicht zerbricht; für diese
  größeren Geräte wird aber vorerst kein eigenes Layout optimiert.

Hinweise zur Abgrenzung gegenüber dem Design-Bundle: Das Mockup zeigt
zusätzlich eine Worker-Status-Karte, eine untere Tab-Leiste (Repos,
Aktivität, Verlauf, Einstellungen) und einen Dark-/Light-Umschalter.
Von diesem Req ist NUR die Repo-Verwaltung (Repos-Tab: Liste, Hinzufügen,
Sortieren, Aktiv/Inaktiv, Entfernen, Leerzustand) umzusetzen; die übrigen
Tabs und die Worker-Status-Karte sind hier Out of Scope (siehe unten).
Die im Bundle enthaltenen `.dc.html`-Laufzeit und der iOS-Rahmen
(`ios-frame (1).jsx`) sind reine Präsentations-Hilfen und werden nicht
mit ausgeliefert.

# Acceptance Criteria

- [ ] Given die Repo-Liste ist leer, when ich die Verwaltungsseite
  öffne, then sehe ich den Hinweis "Noch keine Repos — füge dein erstes
  hinzu" und einen Button "Repo hinzufügen".
- [ ] Given ich gebe die Git-URL "https://github.com/kruianer/appbaua.git"
  ohne Anzeigename ein und das Repo ist erreichbar, when ich es
  hinzufüge, then erscheint ein neuer Listeneintrag mit dem Anzeigenamen
  "appbaua".
- [ ] Given ich öffne das Hinzufügen-Formular, when es angezeigt wird,
  then sehe ich eine Auswahlliste der über den GitHub-Token erreichbaren
  Repos UND ein Feld für die manuelle Git-URL-Eingabe.
- [ ] Given ich wähle das Repo "kruianer/appbaua" aus der Auswahlliste,
  when ich es hinzufüge, then erscheint es als neuer Listeneintrag, ohne
  dass ich eine URL eintippen musste.
- [ ] Given ich gebe eine Git-URL ein, auf die der hinterlegte Token
  keinen Zugriff hat, when ich sie hinzufügen will, then wird das Repo
  NICHT hinzugefügt und ich sehe die Meldung "Repo nicht erreichbar oder
  kein Zugriff".
- [ ] Given die Git-URL "https://github.com/kruianer/appbaua.git" steht
  bereits in der Liste, when ich dieselbe URL erneut hinzufügen will,
  then wird sie NICHT hinzugefügt und ich sehe die Meldung "Dieses Repo
  ist bereits in der Liste".
- [ ] Given die Liste enthält die Repos "appbaua" (Position 1) und
  "worker" (Position 2), when ich "worker" per Drag & Drop an Position 1
  ziehe, then steht "worker" oben und die neue Reihenfolge ist ohne
  weiteres Speichern erhalten (auch nach Neuladen der Seite).
- [ ] Given ein aktives Repo "appbaua", when ich es auf inaktiv schalte,
  then bleibt es an seiner Position und wird ausgegraut als inaktiv
  dargestellt.
- [ ] Given ein Repo "appbaua" in der Liste, when ich auf "Entfernen"
  klicke, then erscheint zuerst eine Rückfrage "Repo appbaua wirklich
  entfernen?"; erst nach Bestätigung verschwindet der Eintrag.
- [ ] Given der Entfernen-Bestätigungsdialog ist offen, when ich ihn
  abbreche, then bleibt das Repo unverändert in der Liste (es wird NICHT
  entfernt).
- [ ] Given ich öffne die Verwaltungsseite auf einem Smartphone im
  Hochformat, when die Liste angezeigt wird, then sind alle Einträge und
  Bedienelemente ohne horizontales Scrollen sichtbar und bedienbar
  (inklusive Umsortieren per Touch).

# Constraints

- Die Repos sind private GitHub-Repos. Zugriff und Erreichbarkeitstest
  erfolgen über einen zentral/projektweit hinterlegten GitHub Personal
  Access Token (nicht pro Repo eingegeben). Der Token selbst wird in
  einem separaten Requirement/Setup konfiguriert; dieses Requirement
  nutzt ihn nur.

# Out of Scope

- Wie der Worker die Liste tatsächlich abarbeitet (Durchgehen der Repos,
  Klonen, Prioritäts-Logik) — separates Requirement.
- Bedienung per Telegram — separates Requirement.
- Zugangsschutz/Login für die Verwaltungsseite — separates Requirement.
- Konfiguration/Hinterlegung des GitHub-Tokens selbst — separates
  Setup/Requirement.
- Repo-spezifische Einstellungen wie Branch-Auswahl oder Notizen pro
  Repo.
- Ein eigens für iPad/Laptop optimiertes Layout — die Seite muss dort
  nur nutzbar bleiben, nicht speziell gestaltet sein.
- Die Worker-Status-Karte aus dem Mockup (zeigt die aktuelle Aufgabe des
  Workers) — separates Requirement.
- Die weiteren Tabs aus dem Mockup (Aktivität, Verlauf, Einstellungen)
  inkl. ihrer Inhalte — separate Requirements; die Tab-Leiste selbst darf
  als Navigationsgerüst mit "Bald verfügbar"-Platzhaltern entstehen,
  falls das Design ohne sie zerbricht.
- Der Dark-/Light-Umschalter — falls im Design bereits angelegt, darf er
  bestehen bleiben; er ist aber nicht Prüfgegenstand dieses Req.
