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
