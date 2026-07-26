---
id: req-013
title: Repo-Umstellung legt keinen neuen dev-Branch mehr an
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-07-26
changes: req-012
---

# Goal (Why)

Wenn ich ein Repo auf den appbaua-Standard umstelle, soll im Zielrepo
kein überraschender neuer `dev`-Branch entstehen. Bei frischen Repos,
die nur ihren Default-Branch haben, führte der bisher automatisch
angelegte `dev`-Branch beim Repo-Besitzer zu Rückfragen.

# Function (What)

Ändert das Branch-Verhalten der Repo-Umstellung aus req-012. Bisher
pushte die Umstellung immer auf `dev` und legte diesen an, falls er
fehlte. Neu:

- Hat das Zielrepo bereits einen `dev`-Branch, pusht die Umstellung wie
  bisher dorthin.
- Hat das Zielrepo KEINEN `dev`-Branch, pusht die Umstellung auf den
  Default-Branch des Zielrepos. Es wird KEIN neuer `dev`-Branch angelegt.

Alles Übrige an der Umstellung bleibt unverändert (welche Skills und
Ordner kopiert werden, Idempotenz, Abbruch ohne Push bei Fehler, dass
die Instruktions-Dateien im delivery-Root nie angefasst werden). Auch
die Ergebnismeldung bleibt, nennt jetzt aber den tatsächlich
verwendeten Ziel-Branch.

# Acceptance Criteria

- [ ] Given ein Zielrepo "kruianer/neu-repo" hat nur einen
  `main`-Branch und keinen `dev`, when ich es umstelle, then wird auf
  `main` gepusht und es existiert danach KEIN `dev`-Branch im Zielrepo.
- [ ] Given ein Zielrepo "kruianer/hat-dev" hat einen `dev`-Branch,
  when ich es umstelle, then wird auf `dev` gepusht (nicht auf den
  Default-Branch).
- [ ] Given ein Zielrepo, dessen Default-Branch "master" heißt (kein
  `dev` vorhanden), when ich es umstelle, then wird auf "master" gepusht
  (nicht auf einen neu angelegten `main`- oder `dev`-Branch).
- [ ] Given eine erfolgreiche Umstellung, when die Ergebnismeldung
  erscheint, then nennt sie den tatsächlich verwendeten Ziel-Branch.

# Out of Scope

- Änderung daran, WAS kopiert wird (Skills, delivery-Struktur) — das
  bleibt wie in req-012.
- Einbringen per Pull Request statt direktem Push — es bleibt beim
  direkten Push.
- Ein Umschalter in der Oberfläche, über den der Ziel-Branch pro Repo
  gewählt werden kann.
