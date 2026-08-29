import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { defaultTaskTypes } from "@/lib/task-types";
import type { Repo } from "@/lib/repos";

// req-012 (GUI): every repo entry offers "Auf appbaua umstellen". While it runs
// the entry shows a running indicator, afterwards the short result — the counts
// and the target branch, or the concrete error.

const repos: Repo[] = [
  {
    id: "r1",
    name: "leer-repo",
    url: "github.com/kruianer/leer-repo",
    active: true,
    model: "sonnet",
    monitored: false,
  },
  {
    id: "r2",
    name: "zweites-repo",
    url: "github.com/kruianer/zweites-repo",
    active: true,
    model: "sonnet",
    monitored: false,
  },
];

const SUCCESS_MESSAGE =
  "6 Skills kopiert · 5 delivery-Ordner (5 neu) · CLAUDE.md angelegt · " +
  "Ziel-Branch: dev — auf dev gepusht";

const dashboard = {
  phase: "idle",
  currentRepo: null,
  currentType: null,
  stepStartedAt: null,
  pauseUntil: null,
  today: { done: 0, errors: 0 },
  activeRepos: 2,
  totalRepos: 2,
  dueTypes: 5,
  lastError: null,
};

/** What the rollout endpoint answers, and the calls it saw. */
let answer: { ok: boolean; body: unknown };
let calls: string[] = [];
/** Set to hold the endpoint open, so the running state can be observed. */
let held: Promise<void> | null = null;
let release: () => void = () => {};

function holdRollout() {
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
}

beforeEach(() => {
  answer = { ok: true, body: { message: SUCCESS_MESSAGE } };
  calls = [];
  held = null;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/appbaua")) {
      calls.push(url);
      if (held) await held;
      return { ok: answer.ok, json: async () => answer.body };
    }
    if (url.startsWith("/api/worker-status")) {
      return { ok: true, json: async () => dashboard };
    }
    return { ok: true, json: async () => ({}) };
  });
});

const REPO_ID: Record<string, string> = {
  "leer-repo": "r1",
  "zweites-repo": "r2",
};

/** Render and switch to the Repo-Verwaltung, where the button lives. */
async function openRepos(user: ReturnType<typeof userEvent.setup>) {
  render(
    <AppShell
      initialRepos={repos}
      initialTaskTypes={defaultTaskTypes()}
      initialWorkerEnabled
    />,
  );
  await screen.findByText("Leerlauf — nichts zu tun"); // Dashboard hat geladen
  await user.click(screen.getByRole("button", { name: "Repos" }));
}

const rolloutButton = (name: string) =>
  screen.getByRole("button", { name: `${name} auf appbaua umstellen` });

// req-030: the rollout button sits in the repo row's second line, which is
// collapsed by default and only shown after a click on the name/URL area
// (same toggle pattern as the Task-Typen, see AppShell.test.tsx).
const openRow = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const id = REPO_ID[name];
  const toggle = document.querySelector<HTMLButtonElement>(
    `[data-repo-row][data-id="${id}"] button`,
  )!;
  await user.click(toggle);
};

describe("Repo-Verwaltung — Auf appbaua umstellen (req-012)", () => {
  it("AC: jeder Repo-Eintrag hat den Button", async () => {
    const user = userEvent.setup();
    await openRepos(user);

    await openRow(user, "leer-repo");
    expect(rolloutButton("leer-repo")).toBeInTheDocument();

    await openRow(user, "zweites-repo");
    expect(rolloutButton("zweites-repo")).toBeInTheDocument();
  });

  it("AC: während der Umstellung läuft ein Indikator, danach kommt die Meldung", async () => {
    const user = userEvent.setup();
    holdRollout();
    await openRepos(user);
    await openRow(user, "leer-repo");

    await user.click(rolloutButton("leer-repo"));
    expect(await screen.findByText("Wird umgestellt …")).toBeInTheDocument();

    release();
    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Wird umgestellt …")).not.toBeInTheDocument();
    expect(calls).toEqual(["/api/repos/r1/appbaua"]);
  });

  it("AC: die Meldung nennt die Anzahlen und den Ziel-Branch", async () => {
    const user = userEvent.setup();
    await openRepos(user);
    await openRow(user, "leer-repo");

    await user.click(rolloutButton("leer-repo"));

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("6 Skills kopiert");
    expect(result).toHaveTextContent("5 delivery-Ordner");
    expect(result).toHaveTextContent("Ziel-Branch: dev");
  });

  it("AC: schlägt die Umstellung fehl, steht der konkrete Grund am Eintrag", async () => {
    answer = {
      ok: false,
      body: {
        error: "Zielrepo konnte nicht vorbereitet werden: repository not found",
      },
    };
    const user = userEvent.setup();
    await openRepos(user);
    await openRow(user, "leer-repo");

    await user.click(rolloutButton("leer-repo"));

    expect(
      await screen.findByText(
        "Zielrepo konnte nicht vorbereitet werden: repository not found",
      ),
    ).toBeInTheDocument();
  });

  it("ein Netzwerkfehler bleibt am Eintrag sichtbar und hängt nicht im Indikator", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/appbaua")) throw new Error("offline");
      if (url.startsWith("/api/worker-status")) {
        return { ok: true, json: async () => dashboard };
      }
      return { ok: true, json: async () => ({}) };
    });
    const user = userEvent.setup();
    await openRepos(user);
    await openRow(user, "leer-repo");

    await user.click(rolloutButton("leer-repo"));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Umstellung fehlgeschlagen",
    );
    expect(screen.queryByText("Wird umgestellt …")).not.toBeInTheDocument();
  });

  it("solange eine Umstellung läuft, startet kein zweiter Lauf", async () => {
    const user = userEvent.setup();
    holdRollout();
    await openRepos(user);
    await openRow(user, "leer-repo");

    await user.click(rolloutButton("leer-repo"));
    await screen.findByText("Wird umgestellt …");

    // req-030: das zweite Repo öffnen klappt das erste zu (nur eins zur
    // Zeit) — die laufende Umstellung läuft im Hintergrund weiter.
    await openRow(user, "zweites-repo");
    expect(rolloutButton("zweites-repo")).toBeDisabled();
    await user.click(rolloutButton("zweites-repo"));
    expect(calls).toEqual(["/api/repos/r1/appbaua"]);

    await openRow(user, "leer-repo");
    release();
    await screen.findByText(SUCCESS_MESSAGE);

    await openRow(user, "zweites-repo");
    expect(rolloutButton("zweites-repo")).toBeEnabled();
  });

  it("ein erneuter Lauf ersetzt die alte Meldung, statt sie zu doppeln", async () => {
    const user = userEvent.setup();
    await openRepos(user);
    await openRow(user, "leer-repo");

    await user.click(rolloutButton("leer-repo"));
    await screen.findByText(SUCCESS_MESSAGE);

    answer = {
      ok: true,
      body: {
        message:
          "6 Skills kopiert · 5 delivery-Ordner · CLAUDE.md unverändert · " +
          "Ziel-Branch: dev — keine Änderungen nötig, war bereits auf Stand",
      },
    };
    await user.click(rolloutButton("leer-repo"));

    expect(
      await screen.findByText(/keine Änderungen nötig/),
    ).toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
