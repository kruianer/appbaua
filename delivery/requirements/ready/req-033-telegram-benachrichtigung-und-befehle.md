---
id: req-033
title: Telegram meldet Ausfälle und nimmt Befehle entgegen
app: appbaua
area: App-Überwachung
priority: normal
created: 2026-08-29
---

# Goal (Why)

Die Zustandsübersicht hilft mir nur, wenn ich hinschaue. Ich will von
einem Ausfall erfahren, ohne die App zu öffnen — und von unterwegs
nachsehen und eingreifen können, ohne mich anzumelden.

# Function (What)

appbaua schickt mir eine Telegram-Nachricht, sobald eine überwachte
Prüfung zweimal hintereinander fehlschlägt (req-032). Die Nachricht nennt
die App, die betroffene Prüfung und was genau fehlgeschlagen ist.

Erholt sich die Prüfung wieder, kommt eine zweite Nachricht mit der
Entwarnung. Dazwischen kommt nichts — solange sich am Zustand nichts
ändert, bleibt es still.

Über denselben Chat kann ich Befehle schicken:

- `/status` — der Zustand aller überwachten Apps als Übersicht
- `/status <app>` — die einzelnen Prüfungen einer App
- `/neustart <container>` — startet einen Container neu, nach einer
  Rückfrage, die ich bestätigen muss

appbaua reagiert ausschließlich auf Nachrichten aus meinem Chat. Die
zugelassene Chat-Kennung ist fest hinterlegt; Nachrichten aus anderen
Chats werden verworfen, ohne dass darauf geantwortet wird.

In den Einstellungen kann ich die Telegram-Meldungen abschalten, ohne die
Überwachung selbst abzuschalten.

# Acceptance Criteria

- [ ] Given eine überwachte Prüfung schlägt zweimal hintereinander fehl,
  when die zweite Prüfrunde endet, then bekomme ich eine
  Telegram-Nachricht, die App, Prüfung und Grund nennt.
- [ ] Given eine Prüfung ist einmal fehlgeschlagen und beim zweiten Mal
  wieder in Ordnung, when die zweite Prüfrunde endet, then bekomme ich
  KEINE Nachricht.
- [ ] Given eine Prüfung steht seit Stunden auf Rot, when weitere
  Prüfrunden laufen, then kommt KEINE weitere Nachricht zu derselben
  Prüfung.
- [ ] Given eine gemeldete Prüfung ist wieder in Ordnung, when die
  nächste Prüfrunde das feststellt, then bekomme ich genau eine
  Entwarnung.
- [ ] Given ich schicke `/status`, when der Bot antwortet, then sehe ich
  je überwachter App eine Zeile mit ihrem Zustand.
- [ ] Given ich schicke `/neustart lgt-prod-monitoring-watchdog`, when
  der Bot antwortet, then fragt er zuerst nach — und erst nach meiner
  Bestätigung wird der Container neu gestartet.
- [ ] Given ich schicke `/neustart` und bestätige die Rückfrage NICHT,
  when ich stattdessen etwas anderes schreibe, then wird NICHTS neu
  gestartet.
- [ ] Given jemand anderes schreibt dem Bot `/status` oder `/neustart`,
  when die Nachricht eintrifft, then bekommt diese Person KEINE Antwort
  und es wird nichts ausgeführt.
- [ ] Given ich habe die Telegram-Meldungen in den Einstellungen
  abgeschaltet, when eine Prüfung fehlschlägt, then kommt KEINE
  Nachricht — die Zustandsseite zeigt den Ausfall trotzdem an.
- [ ] Given Telegram ist gerade nicht erreichbar, when eine Nachricht
  verschickt werden soll, then läuft die Überwachung normal weiter und
  der fehlgeschlagene Versand steht im Verlauf.

# Constraints

- Ein Telegram-Bot ist öffentlich ansprechbar: Jeder, der seinen Namen
  kennt, kann ihm schreiben. Der Schutz liegt allein darin, dass nur die
  hinterlegte Chat-Kennung akzeptiert wird.
- Bot-Schlüssel und Chat-Kennung liegen in den env-Dateien der Umgebung
  (`~/appbaua-env/*.env`), nie im Repo.
- Ein Neustart betrifft echte laufende Systeme, auch prod-Umgebungen
  fremder Apps.

# Out of Scope

- Benachrichtigung auf anderen Wegen (E-Mail, Push, SMS).
- Andere Befehle als Status und Neustart — kein Deploy, kein
  Konfigurieren, kein Worker-Steuern über Telegram.
- Meldungen über den Worker-Betrieb (fertige Requirements, Fehlschläge) —
  hier geht es nur um die Gesundheit der überwachten Apps.
- Mehrere Empfänger oder Gruppen-Chats.
- Erinnerungen an einen andauernden Ausfall.
