---
id: req-046
title: Release-Info zu jedem fertigen Paket
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-10-17
---

# Goal (Why)

Wenn der Worker ein Paket abgeschlossen hat, weiß ich nicht, was ich
jetzt anders machen kann. Der Verlauf erzählt, welche Dateien angefasst
wurden und welche Tests grün sind — aber nicht, was sich für mich
ändert. Bei Funktionen ohne Oberfläche ist das die einzige Spur, und
dort fehlt sie ganz.

# Function (What)

Hat der Worker ein Requirement oder einen Bug abgeschlossen, schreibt
er dazu eine Release-Info in das Ziel-Repo.

Sie steht in meiner Sprache, nicht in seiner: **was jetzt anders ist**,
und falls ich dafür etwas tun muss, **was**. Keine Dateinamen, keine
Testzahlen — die stehen im Verlauf.

Für eine Funktion ohne Oberfläche sagt sie, woran ich überhaupt merke,
dass es sie gibt.

In appbaua kann ich die Release-Infos aller Repos lesen, nach Datum
sortiert, neueste zuerst.

# Acceptance Criteria

- [x] Given der Worker hat ein Requirement abgeschlossen, when ich ins
      Ziel-Repo sehe, then liegt dort eine Release-Info dazu.
- [x] Given der Worker hat einen Bug behoben, when ich ins Ziel-Repo
      sehe, then liegt dort eine Release-Info dazu.
- [x] Given ich lese eine Release-Info, when ich sie durchgehe, then
      steht dort in einem Satz, was jetzt anders ist.
- [x] Given das Paket betraf eine Funktion ohne Oberfläche, when ich
      die Release-Info lese, then steht dort, woran ich merke, dass es
      sie gibt.
- [x] Given ich muss selbst etwas tun, damit die Änderung wirkt (z.B.
      eine Einstellung setzen), when ich die Release-Info lese, then
      steht dort, was.
- [x] Given ich lese eine Release-Info, when ich sie durchgehe, then
      stehen dort KEINE Dateinamen und KEINE Testzahlen.
- [x] Given ich öffne die Release-Infos in appbaua, when sie erscheinen,
      then sehe ich die Einträge aller Repos, neueste zuerst.
- [x] Given ich sehe die Liste, when ich einen Eintrag ansehe, then
      erkenne ich, zu welchem Repo und zu welchem Paket er gehört.
- [x] Given ein Paket wurde abgebrochen oder ist fehlgeschlagen, when
      ich ins Repo sehe, then entsteht dafür KEINE Release-Info.
- [x] Given ich lese die Release-Infos auf dem iPhone, when ich sie
      durchgehe, then muss ich nicht seitlich schieben.

# Constraints

- Die Release-Info entsteht beim Abschließen eines Pakets, im selben
  Lauf. Sie wird nicht nachträglich aus dem Verlauf erzeugt — dort
  steht der technische Bericht, nicht die Wirkung.
- Sie liegt im Ziel-Repo, nicht in appbauas Datenbank. appbaua liest
  sie von dort.

# Out of Scope

- Ein Formular, in dem ich selbst Release-Infos schreibe. Diese Texte
  schreibt der Worker; ich lese sie.
- Eine Versionsnummer oder ein Bündeln mehrerer Pakete zu einem
  Release.
- Eine Benachrichtigung (z.B. per Telegram), wenn eine neue
  Release-Info entsteht.
- Release-Infos für wiederkehrende Aufgaben (Security, Doku, Ideen,
  Code-Review). Sie ändern nichts an dem, was ich tun kann.
- Nachträgliche Release-Infos für bereits abgeschlossene Pakete.
