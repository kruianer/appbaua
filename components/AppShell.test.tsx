import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { defaultTaskTypes } from "@/lib/task-types";
import type { Repo } from "@/lib/repos";
import type { RunLogEntry } from "@/lib/run-log";

// Bottom navigation + the Einstellungen tab end-to-end against a stubbed API
// (req-007): deleting the log must empty the Verlauf tab and leave repos and
// task types untouched.

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true },
];

function logEntry(): RunLogEntry {
  const at = new Date(2026, 6, 24, 12, 0).toISOString();
  return {
    id: 1,
    startedAt: at,
    endedAt: at,
    repo: "appbaua",
    taskType: "Bugs",
    status: "success",
    message: "erledigt",
  };
}

let entries: RunLogEntry[];

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data };
}

const dashboard = {
  phase: "idle",
  currentRepo: null,
  currentType: null,
  stepStartedAt: null,
  pauseUntil: null,
  today: { done: 0, errors: 0 },
  activeRepos: 1,
  totalRepos: 1,
  dueTypes: 5,
  lastError: null,
};

beforeEach(() => {
  entries = [logEntry()];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/worker-status")) return jsonResponse(dashboard);
    if (url.startsWith("/api/run-log")) {
      if (init?.method === "DELETE") {
        entries = [];
        return jsonResponse({ total: 0 });
      }
      return jsonResponse({
        entries,
        total: entries.length,
        page: 0,
        hasMore: false,
      });
    }
    return jsonResponse({});
  });
});

function renderShell() {
  return render(
    <AppShell
      initialRepos={repos}
      initialTaskTypes={defaultTaskTypes()}
      initialWorkerEnabled
    />,
  );
}

describe("AppShell navigation (req-007)", () => {
  it("AC: the bottom navigation has five entries in order", async () => {
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun"); // dashboard settled
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    const labels = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual([
      "Aktivität",
      "Verlauf",
      "Repos",
      "Tasks",
      "Einstellungen",
    ]);
  });

  it("AC: clearing the log empties the Verlauf tab, repos and tasks survive", async () => {
    const user = userEvent.setup();
    renderShell();

    // Verlauf has one entry to begin with.
    await user.click(screen.getByRole("button", { name: "Verlauf" }));
    expect(await screen.findByText("Bugs × appbaua")).toBeInTheDocument();

    // Delete it from the Einstellungen tab.
    await user.click(screen.getByRole("button", { name: "Einstellungen" }));
    expect(
      await screen.findByText("Aktuell 1 Eintrag im Verlauf"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Verlauf-Log löschen" }),
    );
    await user.click(screen.getByRole("button", { name: "Löschen" }));
    expect(await screen.findByText("Verlauf gelöscht")).toBeInTheDocument();

    // Verlauf now shows its empty state.
    await user.click(screen.getByRole("button", { name: "Verlauf" }));
    expect(
      await screen.findByText("Noch keine Läufe protokolliert."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bugs × appbaua")).not.toBeInTheDocument();

    // Repos and task types are untouched.
    await user.click(screen.getByRole("button", { name: "Repos" }));
    expect(
      screen.getByText("github.com/kruianer/appbaua"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(screen.getByText("Requirements")).toBeInTheDocument();
  });
});
