import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { defaultTaskTypes } from "@/lib/task-types";
import type { Repo } from "@/lib/repos";
import type { RunLogEntry } from "@/lib/run-log";

// Bottom navigation + the Einstellungen tab end-to-end against a stubbed API
// (req-007): deleting the log must empty the Verlauf tab and leave repos and
// task types untouched.

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true, model: "sonnet", monitored: false },
  { id: "r2", name: "beta", url: "github.com/kruianer/beta", active: true, model: "sonnet", monitored: false },
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
/** Serverseitiger Stand der Repos, wie ihn die echten API-Routen
 * (PATCH /api/repos/:id, PATCH /api/repos/:id/model, POST /api/repos/:id/appbaua)
 * zurückgeben. */
let serverRepos: Repo[];
/** req-040 AC8: welche Repos gerade eine ungesehene, fertige Chat-Antwort haben. */
let chatUnreadRepoIds: string[];

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data };
}

// req-041: ab 744px zeigt AppShell die Seitenleiste statt der unteren Leiste
// (eigene Tests weiter unten). Diese Suite prüft weiterhin das iPhone-
// Verhalten aus req-039/req-007, darum hier fest auf Telefonbreite stellen.
function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
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
  setWindowWidth(390);
  window.localStorage.clear();
  entries = [logEntry()];
  systemCalls = 0;
  serverTaskTypes = defaultTaskTypes();
  serverWorkerEnabled = true;
  serverRepos = repos.map((r) => ({ ...r }));
  chatUnreadRepoIds = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    // Mirrors GET /api/chat/unread (req-040 AC8).
    if (url === "/api/chat/unread") {
      return jsonResponse({ repoIds: chatUnreadRepoIds });
    }
    // Mirrors PATCH /api/repos/:id (lib/repo-service#toggleRepo).
    const repoToggleMatch = /^\/api\/repos\/([^/]+)$/.exec(url);
    if (repoToggleMatch && init?.method === "PATCH") {
      const id = repoToggleMatch[1];
      serverRepos = serverRepos.map((r) =>
        r.id === id ? { ...r, active: !r.active } : r,
      );
      return jsonResponse({ repos: serverRepos });
    }
    // Mirrors PATCH /api/repos/:id/monitored (req-032).
    const repoWatchMatch = /^\/api\/repos\/([^/]+)\/monitored$/.exec(url);
    if (repoWatchMatch && init?.method === "PATCH") {
      const id = repoWatchMatch[1];
      serverRepos = serverRepos.map((r) =>
        r.id === id ? { ...r, monitored: !r.monitored } : r,
      );
      return jsonResponse({ repos: serverRepos });
    }
    // Mirrors PATCH /api/repos/:id/model (req-028).
    const repoModelMatch = /^\/api\/repos\/([^/]+)\/model$/.exec(url);
    if (repoModelMatch && init?.method === "PATCH") {
      const id = repoModelMatch[1];
      const body = JSON.parse(String(init.body));
      serverRepos = serverRepos.map((r) =>
        r.id === id ? { ...r, model: body.model } : r,
      );
      return jsonResponse({ repos: serverRepos });
    }
    // Mirrors POST /api/repos/:id/appbaua (req-012).
    if (/^\/api\/repos\/[^/]+\/appbaua$/.test(url) && init?.method === "POST") {
      return jsonResponse({ message: "Umstellung abgeschlossen." });
    }
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

// req-039: die Leiste aus req-007 (sechs gleich aussehende Plätze) ist
// ersetzt durch fünf Plätze mit Chat in der Mitte und "Mehr" für die drei
// ausgelagerten Menüpunkte.
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Mehr" }));
}

async function gotoViaMore(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await openMore(user);
  await user.click(screen.getByRole("menuitem", { name: label }));
}

describe("Untere Navigation — fünf Plätze (req-039)", () => {
  it("AC: die untere Leiste hat genau fünf Plätze", async () => {
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun"); // dashboard settled
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav).getAllByRole("button")).toHaveLength(5);
  });

  it("AC: die Beschriftungen lauten von links nach rechts Aktivität, Verlauf, Chat, Repos, Mehr", async () => {
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    const labels = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual(["Aktivität", "Verlauf", "Chat", "Repos", "Mehr"]);
  });

  it("AC: das Chat-Symbol ist von einem Kreis umrandet und größer als die anderen", async () => {
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const chatButton = screen.getByRole("button", { name: "Chat" });
    const circle = chatButton.querySelector<HTMLElement>("div")!;
    const circleStyle = circle.getAttribute("style") ?? "";
    expect(circleStyle).toContain("border-radius: 999px");
    expect(circleStyle).toMatch(/border:\s*2px solid/);

    const chatSvg = circle.querySelector("svg")!;
    const otherSvg = screen
      .getByRole("button", { name: "Repos" })
      .querySelector("svg")!;
    expect(Number(chatSvg.getAttribute("width"))).toBeGreaterThan(
      Number(otherSvg.getAttribute("width")),
    );
  });

  it('AC: "Mehr" öffnet eine Liste mit genau drei Einträgen', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    await openMore(user);

    const menu = screen.getByRole("menu", { name: "Mehr" });
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((b) => b.textContent);
    expect(items).toEqual(["Zustand", "Tasks", "Einstellungen"]);
  });

  it('AC: ein Tipp auf "Zustand" in der Liste zeigt die Zustandsübersicht und schließt die Liste', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    await gotoViaMore(user, "Zustand");

    expect(screen.getByRole("heading", { name: "Zustand" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("AC: ein Tipp daneben schließt die Liste, ohne den Menüpunkt zu ändern", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    await openMore(user);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Außerhalb der Liste tippen — direkt auf den Überlay-Hintergrund.
    fireEvent.click(container.querySelector("[data-more-backdrop]")!);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Aktivität" }),
    ).toBeInTheDocument();
  });

  it("AC: beim Neuöffnen ist der Menüpunkt Aktivität aktiv", async () => {
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    expect(
      screen.getByRole("heading", { name: "Aktivität" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aktivität" }).getAttribute("style"),
    ).toContain("var(--color-accent)");
  });

  it("AC: Zustand erscheint nicht als sechster Platz in der Leiste", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    await gotoViaMore(user, "Zustand");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav).getAllByRole("button")).toHaveLength(5);
    expect(
      within(nav).queryByRole("button", { name: "Zustand" }),
    ).not.toBeInTheDocument();
  });
});

// req-041: ab 744px Fensterbreite wandert die Navigation von der unteren
// Leiste in eine Seitenleiste am linken Rand; am iPhone (< 744px) bleibt
// req-039 unverändert.
describe("Seitenleiste statt untere Leiste ab 744px (req-041)", () => {
  it("AC: bei 1280px steht die Navigation am linken Rand", async () => {
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(nav.previousElementSibling).toBeNull();
  });

  it("AC: bei 1280px gibt es unten KEINE Leiste", async () => {
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    expect(screen.queryByRole("button", { name: "Mehr" })).not.toBeInTheDocument();
    // Die untere Leiste hatte fünf gleichartige Plätze; die Seitenleiste hat
    // sieben (sechs oben + Einstellungen unten) — ein verlässlicher Unterschied.
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav).getAllByRole("button").length).toBeGreaterThan(5);
  });

  it("AC: bei 390px steht die Leiste wie bisher unten, keine Seitenleiste links", async () => {
    setWindowWidth(390);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav).getAllByRole("button")).toHaveLength(5); // req-039
    expect(screen.getByRole("button", { name: "Mehr" })).toBeInTheDocument();
  });

  it("AC: die Seitenleiste listet von oben nach unten Aktivität, Verlauf, Chat, Repos, Zustand, Tasks, Einstellungen", async () => {
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    const labels = within(nav)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      // Der Ein-/Ausklapp-Knopf gehört nicht zu den Menüpunkten (eigene AC).
      .filter((l) => l !== "Seitenleiste einklappen" && l !== "Seitenleiste aufklappen");
    expect(labels).toEqual([
      "Aktivität",
      "Verlauf",
      "Chat",
      "Repos",
      "Zustand",
      "Tasks",
      "Einstellungen",
    ]);
  });

  it('AC: es gibt KEINEN Eintrag "Mehr" in der Seitenleiste', async () => {
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    expect(screen.queryByRole("button", { name: "Mehr" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

// req-041 AC6/AC7: die Seitenleiste lässt sich von Hand ein- und ausklappen,
// unabhängig vom Anfangszustand (eigene ACs weiter unten).
describe("Seitenleiste ein-/ausklappen (req-041)", () => {
  it("AC6: ein Tipp auf den Einklapp-Knopf zeigt nur noch Symbole ohne Text", async () => {
    const user = userEvent.setup();
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav).getByRole("button", { name: "Aktivität" }).textContent).toBe(
      "Aktivität",
    );

    await user.click(
      within(nav).getByRole("button", { name: "Seitenleiste einklappen" }),
    );

    expect(within(nav).getByRole("button", { name: "Aktivität" }).textContent).toBe(
      "",
    );
  });

  it("AC7: ein Tipp auf den Aufklapp-Knopf zeigt wieder Symbol und Text", async () => {
    const user = userEvent.setup();
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    await user.click(
      within(nav).getByRole("button", { name: "Seitenleiste einklappen" }),
    );
    expect(within(nav).getByRole("button", { name: "Aktivität" }).textContent).toBe(
      "",
    );

    await user.click(
      within(nav).getByRole("button", { name: "Seitenleiste aufklappen" }),
    );

    expect(within(nav).getByRole("button", { name: "Aktivität" }).textContent).toBe(
      "Aktivität",
    );
  });
});

// req-041 AC8-10: die Fensterbreite gibt nur den ANFANGSZUSTAND vor — ein von
// Hand gesetzter Zustand übersteht einen Neustart (neues render() derselben
// Seite, gleiches localStorage).
describe("Seitenleiste — Anfangszustand und Persistenz (req-041)", () => {
  it("AC8: bei 1280px ist die Seitenleiste beim ersten Erscheinen aufgeklappt", async () => {
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(
      within(nav).getByRole("button", { name: "Aktivität" }).textContent,
    ).toBe("Aktivität");
    expect(
      within(nav).getByRole("button", { name: "Seitenleiste einklappen" }),
    ).toBeInTheDocument();
  });

  it("AC9: bei 800px ist die Seitenleiste beim ersten Erscheinen eingeklappt", async () => {
    setWindowWidth(800);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(
      within(nav).getByRole("button", { name: "Aktivität" }).textContent,
    ).toBe("");
    expect(
      within(nav).getByRole("button", { name: "Seitenleiste aufklappen" }),
    ).toBeInTheDocument();
  });

  it("AC10: eine von Hand eingeklappte Seitenleiste bleibt nach einem Neustart eingeklappt", async () => {
    const user = userEvent.setup();
    setWindowWidth(1280); // würde ohne gespeicherten Zustand aufgeklappt starten
    const { unmount } = renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    await user.click(
      within(nav).getByRole("button", { name: "Seitenleiste einklappen" }),
    );
    expect(
      within(nav).getByRole("button", { name: "Aktivität" }).textContent,
    ).toBe("");

    unmount(); // "App schließen"
    renderShell(); // "neu öffnen"
    await screen.findByText("Leerlauf — nichts zu tun");

    const navAfterRestart = screen.getByRole("navigation", {
      name: "Hauptnavigation",
    });
    expect(
      within(navAfterRestart).getByRole("button", { name: "Aktivität" })
        .textContent,
    ).toBe("");
  });
});

// req-041: AppShell reicht die Fensterbreite an Chat weiter (split-Prop) —
// Chat.test.tsx prüft das Verhalten selbst im Detail (AC11-13).
describe("Chat zweispaltig über AppShell (req-041)", () => {
  it("AC: bei 1280px zeigt der Chat-Tab die Repo-Liste statt der Dropdown-Auswahl", async () => {
    const user = userEvent.setup();
    setWindowWidth(1280);
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    await user.click(within(nav).getByRole("button", { name: "Chat" }));

    expect(screen.queryByRole("combobox", { name: "Repo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "beta" })).toBeInTheDocument();
  });
});

describe("Hinweispunkt auf dem Chat-Knopf (req-040 AC8/AC9)", () => {
  it("AC8: trägt einen Hinweispunkt, wenn ein Repo eine ungesehene Antwort hat", async () => {
    chatUnreadRepoIds = ["r2"];
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Chat" }).querySelector("[data-chat-unread-dot]"),
      ).toBeInTheDocument(),
    );
  });

  it("AC9: ohne ungesehene Antworten ist kein Hinweispunkt zu sehen", async () => {
    chatUnreadRepoIds = [];
    renderShell();
    await screen.findByText("Leerlauf — nichts zu tun");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Chat" }).querySelector("[data-chat-unread-dot]"),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("AppShell navigation (req-007 → req-039)", () => {
  it("AC: clearing the log empties the Verlauf tab, repos and tasks survive", async () => {
    const user = userEvent.setup();
    renderShell();

    // Verlauf has one entry to begin with.
    await user.click(screen.getByRole("button", { name: "Verlauf" }));
    expect(await screen.findByText("Bugs × appbaua")).toBeInTheDocument();

    // Delete it from the Einstellungen tab (reached via "Mehr").
    await gotoViaMore(user, "Einstellungen");
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
    await gotoViaMore(user, "Tasks");
    expect(screen.getByText("Requirements")).toBeInTheDocument();
  });
});

describe("Einstellungen — System-Kacheln (req-009)", () => {
  it("AC: der Bereich System zeigt vier Kacheln mit den Host-Werten", async () => {
    const user = userEvent.setup();
    renderShell();

    await gotoViaMore(user, "Einstellungen");

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

    await gotoViaMore(user, "Einstellungen");
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

    await gotoViaMore(user, "Tasks");
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
    await gotoViaMore(user, "Tasks");

    expect(
      await screen.findByRole("switch", { name: "Code-Review aktiv/inaktiv" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("AC: der Hauptschalter bleibt aus, nachdem man den Tab wechselt und zurückkommt", async () => {
    const user = userEvent.setup();
    renderShell();

    await gotoViaMore(user, "Tasks");
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
    await gotoViaMore(user, "Tasks");

    expect(
      await screen.findByRole("switch", { name: "Worker an/aus" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});

// req-030: the repo row's second line (Modell-Auswahl + "Auf appbaua
// umstellen") used to sit permanently under every entry. It now behaves like
// the Task-Typen (req-002): collapsed by default, expands on a click on the
// name/URL area, only one repo open at a time, and reordering closes it.
describe("Repo-Zeile — aufklappbar (req-030)", () => {
  function nameToggle(container: HTMLElement, id: string) {
    return container.querySelector<HTMLButtonElement>(
      `[data-repo-row][data-id="${id}"] button`,
    )!;
  }

  function convertButton() {
    return screen.queryByRole("button", {
      name: "appbaua auf appbaua umstellen",
    });
  }

  function modelSelect() {
    return screen.queryByLabelText("appbaua: Modell");
  }

  async function openRepos(user: ReturnType<typeof userEvent.setup>) {
    renderShell();
    await user.click(screen.getByRole("button", { name: "Repos" }));
    await screen.findByText("github.com/kruianer/appbaua");
  }

  it("AC: eingeklappt zeigt der Eintrag weder Modell-Auswahl noch Umstellen-Button", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    expect(convertButton()).not.toBeInTheDocument();
    expect(modelSelect()).not.toBeInTheDocument();
  });

  it("AC: ein Klick auf den Namen klappt die zweite Zeile auf", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    await user.click(nameToggle(document.body, "r1"));

    expect(convertButton()).toBeInTheDocument();
    expect(modelSelect()).toBeInTheDocument();
  });

  it("AC: ein erneuter Klick auf den Namen klappt die zweite Zeile wieder zu", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    const toggle = nameToggle(document.body, "r1");
    await user.click(toggle);
    expect(convertButton()).toBeInTheDocument();

    await user.click(toggle);
    expect(convertButton()).not.toBeInTheDocument();
    expect(modelSelect()).not.toBeInTheDocument();
  });

  it("AC: das Öffnen eines anderen Repos klappt das vorige zu", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    await user.click(nameToggle(document.body, "r1"));
    expect(convertButton()).toBeInTheDocument();

    await user.click(nameToggle(document.body, "r2"));

    expect(convertButton()).not.toBeInTheDocument();
    expect(modelSelect()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "beta auf appbaua umstellen" }),
    ).toBeInTheDocument();
  });

  it("AC: Umsortieren (Drag-Start) klappt einen offenen Bereich zu", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    await user.click(nameToggle(document.body, "r1"));
    expect(convertButton()).toBeInTheDocument();

    const grips = screen.getAllByLabelText("Ziehen zum Umsortieren");
    fireEvent.pointerDown(grips[1], { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(document);

    expect(convertButton()).not.toBeInTheDocument();
    expect(modelSelect()).not.toBeInTheDocument();
  });

  it("AC: der Aktiv-Schalter ändert nur den Zustand, der Bereich bleibt offen", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    await user.click(nameToggle(document.body, "r1"));
    expect(convertButton()).toBeInTheDocument();

    const activeSwitch = screen.getByRole("switch", {
      name: "appbaua aktiv/inaktiv",
    });
    expect(activeSwitch).toHaveAttribute("aria-checked", "true");

    await user.click(activeSwitch);

    await waitFor(() =>
      expect(activeSwitch).toHaveAttribute("aria-checked", "false"),
    );
    expect(convertButton()).toBeInTheDocument();
    expect(modelSelect()).toBeInTheDocument();
  });

  // req-032: der Schalter "überwachen" wohnt in derselben zweiten Zeile.
  it("req-032: der Überwachen-Schalter ist unabhängig vom Aktiv-Schalter", async () => {
    const user = userEvent.setup();
    await openRepos(user);
    await user.click(nameToggle(document.body, "r1"));

    const watch = screen.getByRole("switch", { name: "appbaua überwachen" });
    const active = screen.getByRole("switch", { name: "appbaua aktiv/inaktiv" });
    expect(watch).toHaveAttribute("aria-checked", "false"); // Vorgabe: aus
    expect(active).toHaveAttribute("aria-checked", "true");

    await user.click(watch);

    await waitFor(() => expect(watch).toHaveAttribute("aria-checked", "true"));
    // Der andere Schalter hat sich dabei nicht bewegt.
    expect(active).toHaveAttribute("aria-checked", "true");
  });

  it("AC: nach ausgelöster Umstellung bleibt der Bereich mit der Ergebnismeldung offen", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    await user.click(nameToggle(document.body, "r1"));
    const convert = convertButton()!;
    await user.click(convert);

    expect(
      await screen.findByText("Umstellung abgeschlossen."),
    ).toBeInTheDocument();
    expect(convertButton()).toBeInTheDocument();
    expect(modelSelect()).toBeInTheDocument();
  });
});
