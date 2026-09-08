---
id: req-032
title: Zustandsübersicht aller Apps mit Neustart per Knopfdruck
app: appbaua
area: App-Überwachung
priority: normal
created: 2026-08-22
---

# Goal (Why)

Ich betreibe mehrere Apps auf einer Maschine und merke heute nicht, wenn
eine davon stehenbleibt — ich sehe es zufällig oder gar nicht. Ich will
auf einen Blick erkennen, welche App funktioniert und welche nicht, und
eine hängende App selbst wieder in Gang bringen können, ohne mich auf
den Server einzuloggen.

# Function (What)

appbaua bekommt eine Seite "Zustand". Sie zeigt je überwachter App eine
Karte mit einer Ampel (grün / rot / unbekannt) und darunter die einzelnen
Prüfungen mit ihrem letzten Ergebnis und Zeitpunkt.

Überwacht wird jedes Repo, bei dem ich den Schalter "überwachen"
eingeschaltet habe. Dieser Schalter ist unabhängig vom bestehenden
Schalter, der steuert, ob der Worker das Repo bearbeitet — eine App kann
überwacht werden, ohne dass der Worker an ihr arbeitet, und umgekehrt.

Welche Prüfungen für eine App gelten, steht in der Datei
`delivery/health.md` ihres eigenen Repos. Fehlt sie, laufen nur die
Prüfungen, die ohne Wissen über die App möglich sind (Container). Was
dort nicht beschrieben ist, wird nicht geprüft — appbaua rät nicht.

Prüfarten:

- **Container**: Laufen alle Container der App, und ist keiner in einer
  Neustart-Schleife?
- **Datenbank**: Antwortet die Datenbank auf eine einfache Abfrage?
- **Web**: Antwortet die App unter ihrer öffentlichen Adresse?
- **Zigbee**: Ist der jüngste Sensorwert jünger als die in der
  `health.md` genannte Frist?
- **KI**: Antwortet der KI-Anbieter dieser App (in der Regel OpenAI) auf
  einen kleinen Testaufruf, mit dem Schlüssel der App?

Steht eine Prüfung auf Rot, kann ich auf der Karte den betroffenen
Container einzeln neu starten. appbaua startet nie von sich aus etwas
neu — der Neustart passiert nur auf meinen Klick.

In den Einstellungen lege ich fest, wie oft geprüft wird: ein Abstand
für die laufenden Prüfungen (Vorgabe 5 Minuten) und ein eigener für die
KI-Prüfung (Vorgabe 24 Stunden, weil jeder Aufruf Geld kostet). Jede
Prüfart lässt sich dort auch ganz abschalten.

# Acceptance Criteria

- [ ] Given der Container `lgt-prod-monitoring-watchdog` ist in einer
  Neustart-Schleife, when ich die Zustandsseite öffne, then steht die
  Container-Prüfung von LivingGardenTwin auf Rot und nennt diesen
  Container.
- [ ] Given eine App, deren Container alle laufen und deren Prüfungen
  bestehen, when ich die Zustandsseite öffne, then steht ihre Ampel auf
  Grün.
- [ ] Given ein Repo, bei dem der Schalter "überwachen" ausgeschaltet
  ist, when ich die Zustandsseite öffne, then erscheint für dieses Repo
  KEINE Karte.
- [ ] Given LivingGardenTwin ist für den Worker deaktiviert, aber
  "überwachen" ist eingeschaltet, when ich die Zustandsseite öffne, then
  wird die App trotzdem überwacht und angezeigt.
- [ ] Given ein Repo ohne `delivery/health.md`, when es überwacht wird,
  then laufen nur die Container-Prüfungen, und die übrigen Prüfarten
  erscheinen als "nicht konfiguriert" statt als Rot.
- [ ] Given eine `health.md`, die für Zigbee eine Frist von 30 Minuten
  nennt, und der jüngste Sensorwert ist 45 Minuten alt, when geprüft
  wird, then steht die Zigbee-Prüfung auf Rot.
- [ ] Given ein einzelner Container steht auf Rot, when ich bei ihm "Neu
  starten" klicke, then wird genau dieser Container neu gestartet und
  die übrigen Container derselben App bleiben unberührt.
- [ ] Given ich habe die KI-Prüfung in den Einstellungen abgeschaltet,
  when die nächste Prüfrunde läuft, then wird KEIN Aufruf an den
  KI-Anbieter gemacht.
- [ ] Given eine Prüfung steht auf Rot, when ich nichts tue, then startet
  appbaua von sich aus NICHTS neu.
- [ ] Given ich öffne die Zustandsseite zum ersten Mal nach dem Start von
  appbaua und es liegt noch kein Prüfergebnis vor, when die Seite lädt,
  then sehe ich "noch nicht geprüft" und keine leere Seite.

# Constraints

- Die Apps laufen als Docker-Container auf demselben Rechner wie
  appbaua. Die Container-Prüfung und der Neustart setzen Zugriff auf
  Docker voraus.
- Der Neustart betrifft echte laufende Systeme, auch prod-Umgebungen
  fremder Apps. Er darf ausschließlich auf ausdrücklichen Klick
  geschehen.
- Die KI-Prüfung nutzt den Anbieter und den Schlüssel der jeweiligen App
  (in der Regel OpenAI), nicht den von appbaua. Jeder Aufruf verursacht
  Kosten.
- `delivery/health.md` wird im Zielrepo über den Skill `setup-health`
  angelegt und ist eine neue Datei im Format der übrigen
  Vorgabedateien der Repos (wie `devops.md`, `stack.md`).

# Out of Scope

- Benachrichtigung per Telegram bei Ausfall — eigenes Requirement
  (req-033), das auf dieser Übersicht aufbaut.
- Überwachung von außerhalb des Rechners (Herzschlag zu einem fremden
  Host, damit auch ein Stromausfall auffällt) — eigenes Requirement.
- Automatischer Neustart ohne mein Zutun, auch nicht nach mehrfachem
  Fehlschlag.
- Analyse von Logdateien durch die KI, um die Ursache eines Ausfalls zu
  beschreiben — eigenes Requirement.
- Verlauf und Statistik der Ausfälle über die Zeit (Verfügbarkeit in
  Prozent, Diagramme).
- Neustart der ganzen App auf einmal; es wird immer nur ein einzelner
  Container neu gestartet.
