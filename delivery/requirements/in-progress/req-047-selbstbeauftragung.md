---
id: req-047
title: Der Worker beauftragt sich selbst
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-10-18
---

# Goal (Why)

Für ein Repo, in dem die KI selbst entscheiden soll, was gebaut wird,
fehlt der entscheidende Schritt: Niemand schreibt die Requirements. Der
Ideen-Task legt eine Idee ab, und dort bleibt sie liegen. Gebe ich kein
Feedback, passiert gar nichts — das Repo läuft leer.

# Function (What)

Es gibt eine Task-Art "Selbstauftrag". Ist sie für ein Repo aktiv,
schreibt der Worker dort höchstens **einmal am Tag** ein neues
Requirement nach `delivery/requirements/ready/`.

Woraus er schöpft: der Vision, dem bereits Gebauten (abgeschlossene
Requirements und der Code), früherem Feedback, den offenen Ideen und
den Vorgaben des Repos (Stack, DevOps, CLAUDE.md).

Er schlägt vor, was als Nächstes fehlt — nicht, was ihm einfällt. Die
Nicht-Ziele der Vision sind dabei eine Grenze, keine Anregung.

Findet er nichts Sinnvolles, legt er nichts an. Das ist ein gültiges
Ergebnis, kein Fehler.

Der Selbstauftrag wird **je Repo** eingeschaltet, nicht für alle
gemeinsam. Ohne Einschalten läuft er nirgends.

# Acceptance Criteria

- [x] Given ich öffne den Menüpunkt "Tasks", when ich die Liste ansehe,
      then steht dort eine Task-Art "Selbstauftrag".
- [ ] Given ein Repo wurde neu eingetragen, when ich es ansehe, then
      ist der Selbstauftrag dort NICHT eingeschaltet.
- [ ] Given ich schalte den Selbstauftrag für "Furtgoh" ein, when ich
      ein anderes Repo ansehe, then ist er dort NICHT eingeschaltet.
- [ ] Given der Selbstauftrag ist nur für "Furtgoh" eingeschaltet, when
      der Worker alle Repos durchgeht, then schreibt er NUR dort ein
      Requirement.
- [ ] Given die Task-Art ist für ein Repo aktiv und sie lief heute noch
      nicht, when der Worker das Repo an die Reihe nimmt, then legt er
      dort höchstens ein neues Requirement in `ready/` ab.
- [ ] Given der Worker hat heute in diesem Repo schon einen Selbstauftrag
      geschrieben, when er das Repo erneut an die Reihe nimmt, then legt
      er KEIN zweites an.
- [ ] Given er hat ein Requirement geschrieben, when ich es lese, then
      hat es dieselbe Form wie ein von mir geschriebenes (Frontmatter,
      Funktion, Abnahmekriterien, Out of Scope).
- [ ] Given er hat ein Requirement geschrieben, when ich den Verlauf
      ansehe, then steht dort der Dateiname.
- [ ] Given die Vision des Repos nennt ein Nicht-Ziel, when er ein
      Requirement schreibt, then verstößt es NICHT dagegen.
- [ ] Given er findet nichts, was sinnvoll als Nächstes käme, when der
      Lauf endet, then entsteht KEINE Datei und der Verlauf sagt das.
- [ ] Given das Wochenbudget des Repos ist aufgebraucht (req-044), when
      der Worker den Selbstauftrag ausführen würde, then legt er KEIN
      Requirement an.
- [ ] Given die Task-Art ist aktiv, when der Worker läuft, then ändert
      der Selbstauftrag KEINEN Code — er schreibt nur die .md-Datei.

# Constraints

- Höchstens einmal pro Tag und Repo, wie der Ideen-Task. Zwei Bremsen
  wirken damit unabhängig voneinander: diese tägliche und das
  Wochenbudget aus req-044, das zählt, was abgearbeitet wird.
- Die Vision des Repos ist bindend, insbesondere ihre Nicht-Ziele. Sie
  steht über dem, was der Worker für sinnvoll hält.
- **Der Schalter gehört zum Repo, nicht zur Task-Art.** Das ist der
  Unterschied zu allen bisherigen Task-Arten: Die Tabelle `task_types`
  kennt heute nur `active` ohne Repo-Bezug, ein Schalter dort gilt also
  für alle Repos gemeinsam. Für den Selbstauftrag reicht das nicht —
  er darf nicht versehentlich überall laufen.

  Wie das umgesetzt wird, ist offen: eine Einstellung am Repo (wie das
  Wochenbudget aus req-044 und das Modell aus req-028) oder ein
  Repo-Bezug in den Task-Arten. Ersteres erscheint näher an dem, was
  schon da ist.
- Ohne Einschalten läuft der Selbstauftrag nirgends. Ein Repo, das
  sich nicht selbst beauftragen soll, bleibt unberührt, ohne dass
  jemand etwas abschalten muss.

# Out of Scope

- Das Umsetzen des Requirements. Dafür gibt es die Task-Art
  "Requirements"; der Selbstauftrag schreibt nur.
- Ein Umwandeln bestehender Ideen in Requirements. Die offenen Ideen
  sind eine Quelle, aber sie werden nicht verschoben oder verbraucht.
- Selbstauftrag für Bugs. Ein Fehler wird gefunden, nicht erfunden.
- Eine Begrenzung, wie viele Requirements insgesamt in `ready/` liegen
  dürfen.
- Eine Benachrichtigung, wenn ein Selbstauftrag entstanden ist. Der
  Verlauf und die Release-Infos (req-046) genügen.
