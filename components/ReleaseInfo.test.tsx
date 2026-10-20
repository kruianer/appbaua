import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReleaseInfo } from "./ReleaseInfo";
import type { ReleaseInfoEntry } from "@/lib/release-info-source";

// req-046: Release-Infos aller Repos, neueste zuerst (AC7), jeder Eintrag
// erkennbar nach Repo und Paket (AC8), kein seitliches Verschieben am iPhone
// (AC10) — gleiches Muster wie RunLog (bug-021).

function entry(over: Partial<ReleaseInfoEntry> = {}): ReleaseInfoEntry {
  return {
    repoName: "appbaua",
    packageId: "req-044-wochenbudget-je-repo",
    date: "2026-10-10",
    text: "Du kannst jetzt je Repo ein Wochenbudget setzen.",
    ...over,
  };
}

function stub(entries: ReleaseInfoEntry[]) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ entries }),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReleaseInfo — Liste aller Repos (req-046 AC7/AC8)", () => {
  it("zeigt die Überschrift 'neueste zuerst'", async () => {
    stub([entry()]);
    render(<ReleaseInfo />);
    expect(await screen.findByText("Release-Infos · neueste zuerst")).toBeInTheDocument();
  });

  it("AC8: ein Eintrag nennt Repo und Paket", async () => {
    stub([entry({ repoName: "Forschung", packageId: "bug-002-x" })]);
    render(<ReleaseInfo />);
    expect(await screen.findByText("Forschung · bug-002-x")).toBeInTheDocument();
  });

  it("zeigt den Text des Eintrags", async () => {
    stub([entry({ text: "Jetzt kannst du X." })]);
    render(<ReleaseInfo />);
    expect(await screen.findByText("Jetzt kannst du X.")).toBeInTheDocument();
  });

  it("zeigt mehrere Einträge in der vom Server gelieferten Reihenfolge", async () => {
    stub([
      entry({ repoName: "Forschung", packageId: "bug-002", date: "2026-10-18" }),
      entry({ repoName: "appbaua", packageId: "req-010", date: "2026-10-05" }),
    ]);
    const { container } = render(<ReleaseInfo />);
    await screen.findByText("Forschung · bug-002");
    const titles = [...container.querySelectorAll(".card")].map(
      (c) => c.querySelector("span")?.textContent,
    );
    expect(titles).toEqual(["Forschung · bug-002", "appbaua · req-010"]);
  });

  it("zeigt einen leeren Zustand, wenn es noch keine Einträge gibt", async () => {
    stub([]);
    render(<ReleaseInfo />);
    expect(await screen.findByText("Noch keine Release-Infos.")).toBeInTheDocument();
  });

  // AC10 / bug-021: vertikal scrollen ja, seitlich verschieben nein — langer
  // Text bricht stattdessen um.
  it("AC10: scrollt vertikal, aber nicht seitlich — langer Text bricht um", async () => {
    const lang =
      "EinSehrLangerTextOhneLeerzeichenDerNichtUmbrechenWuerdeWennEsKeineUmbruchregelGaebeUndDadurchDieKarteÜberDenBildschirmrandSchiebenKoennte";
    stub([entry({ text: lang })]);
    const { container } = render(<ReleaseInfo />);
    const text = await screen.findByText(lang);
    expect(text.style.overflowWrap).toBe("anywhere");

    const scroller = container.querySelector<HTMLElement>(
      "[data-releaseinfo-scroll]",
    );
    expect(scroller).not.toBeNull();
    expect(scroller!.style.overflowY).toBe("auto");
    expect(scroller!.style.overflowX).toBe("clip");
  });
});
