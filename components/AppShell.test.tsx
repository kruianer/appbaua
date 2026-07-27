import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { defaultTaskTypes } from "@/lib/task-types";
import type { Repo } from "@/lib/repos";
import type { RunLogEntry } from "@/lib/run-log";

// Bottom navigation + the Einstellungen tab end-to-end against a stubbed API
// (req-007): deleting the log must empty the Verlauf tab and leave repos and
// task types untouched.

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true, model: "sonnet" },
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
/** Abrufe der System-Kacheln — sie dürfen nur laufen, solange der Tab offen ist. */
let systemCalls: number;
/** Serverseitiger Stand von Task-Typen und Hauptschalter, wie ihn die echten
 * API-Routen (PATCH /api/task-types/:id, PUT /api/worker-state) zurückgeben. */
let serverTaskTypes: ReturnType<typeof defaultTaskTypes>;
let serverWorkerEnabled: boolean;

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data };
}

const systemMetrics = {
  disk: { freeBytes: 312_000_000_000, totalBytes: 500_000_000_000 },
  cpu: { percent: 37 },
  workerCpu: { percent: 4 },
  memory: {
    usedBytes: 12_288_000_000,
    freeBytes: 4_096_000_000,
    totalBytes: 16_384_000_000,
  },
};

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
  systemCalls = 0;
  serverTaskTypes = defaultTaskTypes();
  serverWorkerEnabled = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/system-metrics")) {
      systemCalls += 1;
      return jsonResponse(systemMetrics);
    }
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
    // Mirrors PATCH /api/task-types/:id (lib/task-service#toggleTaskType).
    const taskTypeMatch = /^\/api\/task-types\/([^/]+)$/.exec(url);
    if (taskTypeMatch && init?.method === "PATCH") {
      const id = taskTypeMatch[1];
      serverTaskTypes = serverTaskTypes.map((t) =>
        t.id === id ? { ...t, active: !t.active } : t,
      );
      return jsonResponse({ types: serverTaskTypes });
    }
    // Mirrors PUT /api/worker-state.
    if (url.startsWith("/api/worker-state") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      serverWorkerEnabled = body.enabled;
      return jsonResponse({ state: { enabled: serverWorkerEnabled } });
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

describe("Einstellungen — System-Kacheln (req-009)", () => {
  it("AC: der Bereich System zeigt vier Kacheln mit den Host-Werten", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Einstellungen" }));

    expect(await screen.findByText("System")).toBeInTheDocument();
    expect(screen.getByText("Freier Speicherplatz")).toBeInTheDocument();
    expect(screen.getByText("CPU-Last gesamt")).toBeInTheDocument();
    expect(screen.getByText("CPU-Last des Workers")).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
    expect(await screen.findByText("312 GB frei")).toBeInTheDocument();
    expect(screen.getByText("37 %")).toBeInTheDocument();
  });

  it("AC: wechsle ich den Tab, werden keine System-Werte mehr abgefragt", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Einstellungen" }));
    expect(await screen.findByText("37 %")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aktivität" }));
    expect(screen.queryByText("CPU-Last gesamt")).not.toBeInTheDocument();

    const afterLeaving = systemCalls;
    // Länger als ein Takt (1s) warten: ein weiterer Abruf müsste hier auffallen.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(systemCalls).toBe(afterLeaving);
  });
});

// req-015: the header used to sit in the plain body colour, with the logo in a
// gradient tile. Now the bar carries a light accent tint and the logo stands
// free next to the wordmark.
describe("Kopfzeile (req-015)", () => {
  /** One rule of the design stylesheet, from its selector to the closing brace. */
  function cssRule(selector: string): string {
    const css = readFileSync(
      path.join(process.cwd(), "app", "nocturne.css"),
      "utf8",
    );
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  it("AC: the header bar is tinted with the accent, not left in the body colour", async () => {
    const { container } = renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const bar = container.querySelector<HTMLElement>("[data-app-bar]")!;
    expect(bar).toHaveClass("app-bar");
    expect(bar.textContent).toContain("appbaua"); // it really is the header

    // The tint itself lives in the design stylesheet: the accent mixed OVER the
    // background, so the bar stays distinguishable from the body in both themes.
    const rule = cssRule(".app-bar");
    expect(rule).toMatch(/background:\s*color-mix\(/);
    expect(rule).toContain("--color-accent");
    expect(rule).toContain("--color-bg");
  });

  it("AC: the logo stands free — no tile, no coloured box around it", async () => {
    const { container } = renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const logo = container.querySelector<HTMLElement>("[data-logo]")!;
    expect(logo.querySelector("svg")).not.toBeNull();
    expect(logo.style.background).toBe("");
    expect(logo.style.backgroundImage).toBe("");
    expect(logo.style.borderRadius).toBe("");
    expect(logo.style.boxShadow).toBe("");
    expect(logo.style.border).toBe("");

    // …and it sits right next to the wordmark.
    expect(logo.parentElement?.textContent).toContain("appbaua");
  });
});

// bug-009: TaskControl used to own its state via useState(initialTaskTypes),
// initialised once from a prop that goes stale after the first render. The
// Tasks tab unmounts TaskControl when you leave it and remounts it when you
// come back, so that useState re-ran with the stale prop and threw away any
// change made in between — even though the change was already persisted
// server-side. The fix lifts the state into AppShell, which never unmounts.
describe("Task-Steuerung — Zustand übersteht Tab-Wechsel (bug-009)", () => {
  it("AC: ein Task-Typ bleibt deaktiviert, nachdem man den Tab wechselt und zurückkommt", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    const toggle = await screen.findByRole("switch", {
      name: "Code-Review aktiv/inaktiv",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Code-Review aktiv/inaktiv" }),
      ).toHaveAttribute("aria-checked", "false"),
    );

    // Weg vom Tab (TaskControl hängt aus) und zurück (TaskControl mountet neu).
    await user.click(screen.getByRole("button", { name: "Aktivität" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(
      await screen.findByRole("switch", { name: "Code-Review aktiv/inaktiv" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("AC: der Hauptschalter bleibt aus, nachdem man den Tab wechselt und zurückkommt", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    const worker = await screen.findByRole("switch", {
      name: "Worker an/aus",
    });
    expect(worker).toHaveAttribute("aria-checked", "true");

    await user.click(worker);
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Worker an/aus" }),
      ).toHaveAttribute("aria-checked", "false"),
    );

    await user.click(screen.getByRole("button", { name: "Repos" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(
      await screen.findByRole("switch", { name: "Worker an/aus" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});
