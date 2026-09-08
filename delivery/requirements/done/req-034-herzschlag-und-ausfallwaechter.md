---
id: req-034
title: Herzschlag zu einem fremden Host meldet den Totalausfall
app: appbaua
area: App-Überwachung
priority: normal
created: 2026-08-29
---

# Goal (Why)

Die Überwachung läuft auf demselben Rechner wie die Apps. Fällt dieser
Rechner selbst aus — Stromausfall, Internetausfall, appbaua tot —, merkt
es niemand: Der Wächter ist dann mit weg. Ich will genau von diesem Fall
erfahren, und zwar von außerhalb.

# Function (What)

appbaua meldet sich in regelmäßigen Abständen bei einem Wächter, der
NICHT auf demselben Rechner läuft, sondern beim Webhoster. Diese Meldung
enthält nur den Zeitpunkt und eine Kennung — keine Daten über die Apps.

Der Wächter merkt sich, wann die letzte Meldung eintraf. Bleibt sie
länger als 15 Minuten aus, schickt er mir eine Telegram-Nachricht über
denselben Bot wie req-033, mit einem Text, der diesen Fall klar von einem
gewöhnlichen App-Ausfall unterscheidet.

Kommt der Herzschlag wieder, schickt er eine Entwarnung mit der Dauer des
Ausfalls. Dazwischen bleibt es still — eine Nachricht pro Ausfall, nicht
alle 15 Minuten eine neue.

Der Wächter ist bewusst so einfach wie möglich: Er weiß nichts über die
Apps, prüft nichts selbst und kann nichts steuern. Er beantwortet genau
eine Frage — lebt der Rechner noch?

Damit ich sehen kann, dass er funktioniert, zeigt appbaua auf der
Zustandsseite an, wann der letzte Herzschlag angenommen wurde.

# Acceptance Criteria

- [ ] Given appbaua läuft normal, when ich die Zustandsseite öffne, then
  sehe ich, wann der letzte Herzschlag angenommen wurde, und dieser
  Zeitpunkt ist jünger als der eingestellte Abstand.
- [ ] Given der Beelink wird ausgeschaltet, when 15 Minuten ohne
  Herzschlag vergangen sind, then bekomme ich eine Telegram-Nachricht,
  die den Ausfall des Rechners selbst benennt.
- [ ] Given der Rechner ist seit Stunden aus, when weitere Zeit vergeht,
  then kommt KEINE weitere Nachricht zu demselben Ausfall.
- [ ] Given der Rechner läuft wieder und der Herzschlag kommt an, when
  der Wächter ihn annimmt, then bekomme ich eine Entwarnung, die die
  Dauer des Ausfalls nennt.
- [ ] Given appbaua wird für einen Deploy kurz neu gestartet und ist nach
  3 Minuten wieder da, when der Herzschlag weiterläuft, then kommt KEINE
  Nachricht.
- [ ] Given jemand ruft die Adresse des Wächters ohne gültige Kennung
  auf, when die Anfrage eintrifft, then wird sie abgewiesen und NICHT als
  Herzschlag gewertet.
- [ ] Given der Wächter ist nicht erreichbar, when appbaua seinen
  Herzschlag senden will, then läuft appbaua normal weiter und der
  fehlgeschlagene Versand steht im Verlauf.

# Constraints

- Der Wächter läuft beim Webhoster all-inkl. Dort ist ausschließlich PHP
  verfügbar — kein Node, kein Docker, keine Hintergrunddienste.
- Er muss ohne Datenbank auskommen; für den letzten Zeitpunkt genügt eine
  Datei.
- Die regelmäßige Prüfung, ob der Herzschlag ausblieb, muss beim Hoster
  angestoßen werden (Cronjob im Kundenmenü) — das ist ein manueller
  Einrichtungsschritt des Betreibers.
- Bot-Schlüssel, Chat-Kennung und die Kennung des Herzschlags liegen auf
  dem Hoster außerhalb des öffentlich erreichbaren Verzeichnisses, nie im
  Repo.
- Der Wächter läuft bewusst außerhalb der eigenen Infrastruktur. Fällt
  auch der Hoster aus, gibt es keine Meldung — dieser Fall bleibt offen.

# Out of Scope

- Überwachung einzelner Apps durch den Wächter. Er beantwortet nur, ob
  der Rechner lebt; alles Weitere leistet req-032.
- Eine Weboberfläche beim Hoster.
- Ein zweiter Wächter, der den Wächter überwacht.
- Automatisches Wiederanfahren des Rechners (Wake-on-LAN, schaltbare
  Steckdose).
- Benachrichtigung auf anderen Wegen als Telegram.
