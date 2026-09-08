import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunLog } from "./RunLog";
import { type RunLogEntry, RECURRING_MD } from "@/lib/run-log";

// Verlauf tab (req-015): every entry names the .md the run worked off, right
// under "Task-Typ × Repo". The entries come from /api/run-log, so the component
// is driven against a stubbed fetch here.

function entry(over: Partial<RunLogEntry> = {}): RunLogEntry {
  const at = new Date(2026, 6, 26, 10, 30).toISOString();
  return {
    id: 1,
    startedAt: at,
    endedAt: new Date(2026, 6, 26, 10, 42).toISOString(),
    repo: "appbaua",
    taskType: "Requirements",
    status: "success",
    message: "erledigt — auf dev gepusht",
    ...over,
  };
}

function stubLog(entries: RunLogEntry[]) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      entries,
      total: entries.length,
      page: 0,
      hasMore: false,
    }),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Verlauf — .md-Name am Eintrag (req-015)", () => {
  it("AC: shows the .md of the run under 'Task-Typ × Repo'", async () => {
    stubLog([entry({ md: "req-020-beispiel.md" })]);
    const { container } = render(<RunLog />);

    expect(
      await screen.findByText("Requirements × appbaua"),
    ).toBeInTheDocument();
    const name = screen.getByText("req-020-beispiel.md");
    expect(name).toBeInTheDocument();

    // Second line means second line: directly below the title row.
    const card = container.querySelector(".card")!;
    expect(card.children[1]).toBe(name);
  });

  it("AC: a recurring task shows 'wiederkehrende Aufgabe' instead", async () => {
    stubLog([
      entry({ taskType: "Code-Review", md: RECURRING_MD, message: "ok" }),
    ]);
    render(<RunLog />);

    expect(await screen.findByText("Code-Review × appbaua")).toBeInTheDocument();
    expect(screen.getByText("wiederkehrende Aufgabe")).toBeInTheDocument();
  });

  it("AC: an entry from before req-015 shows no second line at all", async () => {
    // entry() stores no md — exactly what the old rows look like.
    stubLog([entry()]);
    const { container } = render(<RunLog />);

    expect(
      await screen.findByText("Requirements × appbaua"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("wiederkehrende Aufgabe"),
    ).not.toBeInTheDocument();
    // Titelzeile, Zeitraum, Meldung — und nichts dazwischen.
    const card = container.querySelector(".card")!;
    expect(card.children).toHaveLength(3);
  });

  it("an idle row ('nichts zu tun') gets no second line either", async () => {
    stubLog([
      entry({
        repo: null,
        taskType: null,
        status: "idle",
        message: "nichts zu tun gefunden",
        md: null,
      }),
    ]);
    const { container } = render(<RunLog />);

    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(
      screen.queryByText("wiederkehrende Aufgabe"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".card")!.children).toHaveLength(3);
  });
});

// bug-021: Der Verlauf ließ sich nicht nur nach oben und unten scrollen,
// sondern auch seitlich verschieben. Fehlermeldungen enthalten lange
// Zeichenketten ohne Leerzeichen — Dateipfade, JSON, Sitzungs-IDs —, und ohne
// Umbruchregel wächst die Karte über die Bildschirmbreite hinaus. Der Fix
// gehört an den Inhalt, nicht an den Rahmen: Ein overflowX: hidden am Container
// würde das Verschieben zwar unterbinden, aber den Text unlesbar abschneiden.
describe("Verlauf — passt in die Bildschirmbreite (bug-021)", () => {
  /** Eine Fehlermeldung, wie sie der Worker tatsächlich schreibt. */
  const LANGE_MELDUNG =
    'Claude-Lauf: Timeout (60 min) — zuletzt: 17-4ef1-99f5-bb3c975e0f8c",' +
    '"uuid":"c837d4f6-eb1e-4f0a-ab78-162d50784695"}{"type":"system",' +
    '"subtype":"api_retry","attempt":4,"session_id":"628b9105-8b17-4ef1"}';

  it("AC: eine lange Fehlermeldung bricht um, statt die Karte aufzuschieben", async () => {
    stubLog([entry({ status: "error", message: LANGE_MELDUNG })]);
    render(<RunLog />);

    const text = await screen.findByText(LANGE_MELDUNG);
    // overflowWrap bricht auch dort, wo es keine Leerzeichen gibt — genau der
    // Fall bei Pfaden und JSON. wordBreak allein reicht in Safari nicht.
    expect(text.style.overflowWrap).toBe("anywhere");
  });

  it("auch der .md-Name bricht um", async () => {
    const langerName = "req-036-etappenweise-arbeiten-und-fortsetzen.md";
    stubLog([entry({ md: langerName })]);
    render(<RunLog />);

    const text = await screen.findByText(langerName);
    expect(text.style.overflowWrap).toBe("anywhere");
  });

  it("AC: der Verlauf scrollt vertikal, laesst sich aber nicht seitlich verschieben", async () => {
    stubLog([entry({ status: "error", message: LANGE_MELDUNG })]);
    const { container } = render(<RunLog />);
    await screen.findByText(LANGE_MELDUNG);

    const scroller = container.querySelector<HTMLElement>("[data-runlog-scroll]");
    expect(scroller).not.toBeNull();
    expect(scroller!.style.overflowY).toBe("auto");
    // Nicht "hidden": Das würde überstehenden Inhalt abschneiden. "clip" hält
    // die Breite, ohne eine Scroll-Möglichkeit anzubieten — der Inhalt passt
    // durch die Umbruchregeln oben ohnehin hinein.
    expect(scroller!.style.overflowX).toBe("clip");
  });
});
