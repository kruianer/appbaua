import { describe, it, expect } from "vitest";
import {
  allDone,
  criteriaOf,
  markDone,
  nextOpen,
  progressLabel,
  stageCommitMessage,
} from "./acceptance-criteria";

// req-036: Die Häkchen sind das Gedächtnis zwischen zwei Läufen. Liest der
// nächste Lauf sie falsch, baut er entweder etwas doppelt oder überspringt
// etwas — beides schlimmer als der heutige Zustand, in dem er schlicht von
// vorne beginnt. Deshalb steht hier eine .md im echten Aufbau der Vorlage.

/** Eine Requirement-Datei, wie capture-requirement sie schreibt. */
const MD = [
  "---",
  "id: req-042",
  "title: Beispiel",
  "---",
  "",
  "# Goal (Why)",
  "",
  "Damit etwas besser wird.",
  "",
  "# Function (What)",
  "",
  "- Eine Aufzählung, die KEIN Kriterium ist",
  "",
  "# Acceptance Criteria",
  "",
  "- [x] Given A, when B, then C",
  "- [ ] Given D, when E, then F",
  "- [ ] Given G, when H, then I",
  "",
  "# Out of Scope",
  "",
  "- [ ] Das hier ist kein Kriterium, sondern eine Abgrenzung",
].join("\n");

describe("criteriaOf (req-036)", () => {
  it("AC: liest die Kriterien mit ihrem Zustand", () => {
    const c = criteriaOf(MD);
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({ done: true, text: "Given A, when B, then C" });
    expect(c[1].done).toBe(false);
    expect(c[2].done).toBe(false);
  });

  it("AC: Kaestchen ausserhalb des Abschnitts sind keine Etappen", () => {
    // Unter "Out of Scope" steht ein Kästchen. Würde es mitzählen, hakte der
    // Worker eine Abgrenzung ab — also Arbeit, die niemand verlangt hat.
    const texte = criteriaOf(MD).map((c) => c.text);
    expect(texte.join(" ")).not.toContain("Abgrenzung");
  });

  it("eine Datei ohne Kriterien-Abschnitt hat keine Etappen", () => {
    expect(criteriaOf("# Observed\n\nEtwas ist kaputt.")).toEqual([]);
    expect(criteriaOf(null)).toEqual([]);
    expect(criteriaOf("")).toEqual([]);
  });

  it("erkennt die deutsche Ueberschrift genauso", () => {
    const de = "# Akzeptanzkriterien\n\n- [ ] Given X, when Y, then Z";
    expect(criteriaOf(de)).toHaveLength(1);
  });

  it("ein grosses X gilt auch als erledigt", () => {
    expect(criteriaOf("# Acceptance Criteria\n- [X] fertig")[0].done).toBe(true);
  });
});

describe("nextOpen / allDone (req-036)", () => {
  it("AC: der naechste Lauf beginnt beim ersten offenen Kriterium", () => {
    expect(nextOpen(criteriaOf(MD))?.text).toBe("Given D, when E, then F");
  });

  it("alles erledigt: kein offenes mehr", () => {
    const fertig = criteriaOf(MD).map((c) => ({ ...c, done: true }));
    expect(nextOpen(fertig)).toBeNull();
    expect(allDone(fertig)).toBe(true);
  });

  it("ohne Kriterien gilt NICHT alles als erledigt", () => {
    // Sonst hielte der Worker einen Bug ohne Kriterien sofort für fertig,
    // ohne eine Zeile Code geschrieben zu haben.
    expect(allDone([])).toBe(false);
  });
});

describe("markDone (req-036)", () => {
  it("AC: setzt genau ein Haekchen und laesst den Rest unveraendert", () => {
    const c = criteriaOf(MD);
    const nach = markDone(MD, c[1].line);
    const neu = criteriaOf(nach);

    expect(neu[1].done).toBe(true);
    expect(neu[0].done).toBe(true); // war schon
    expect(neu[2].done).toBe(false); // bleibt offen
    // Der Text der Zeile bleibt Zeichen für Zeichen stehen.
    expect(neu[1].text).toBe("Given D, when E, then F");
    // Und der Rest der Datei auch.
    expect(nach.split("\n").length).toBe(MD.split("\n").length);
  });

  it("eine Zeile, die kein Kriterium ist, bleibt unangetastet", () => {
    expect(markDone(MD, 0)).toBe(MD);
  });

  it("ein bereits gesetztes Haekchen bleibt gesetzt", () => {
    const c = criteriaOf(MD);
    expect(criteriaOf(markDone(MD, c[0].line))[0].done).toBe(true);
  });
});

describe("progressLabel / stageCommitMessage (req-036)", () => {
  it("der Fortschritt steht als Zahl da", () => {
    expect(progressLabel(criteriaOf(MD))).toBe("1 von 3");
  });

  it("AC: die Commit-Nachricht nennt Paket, Fortschritt und Etappe", () => {
    const c = criteriaOf(MD);
    const msg = stageCommitMessage("req-042-beispiel.md", c, c[1]);
    expect(msg).toBe("req-042-beispiel (1 von 3): Given D, when E, then F");
  });

  it("ein langes Kriterium wird gekuerzt, damit die Betreffzeile lesbar bleibt", () => {
    const lang = {
      line: 0,
      done: false,
      text: "Given ein sehr langes Kriterium mit vielen Woertern, when ich es committe, then soll die Betreffzeile trotzdem lesbar bleiben",
    };
    const msg = stageCommitMessage("req-042-beispiel.md", [lang], lang);
    expect(msg.length).toBeLessThan(100);
    expect(msg).toContain("…");
  });
});
