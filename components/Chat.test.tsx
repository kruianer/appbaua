import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";
import type { Repo } from "@/lib/repos";

// req-040: der Chat-Tab — Repo-Auswahl (auch inaktive Repos), ein leeres
// Eingabefeld, und die Vorauswahl des zuletzt genutzten Repos (AC3).

const cellarVoice: Repo = {
  id: "r1",
  name: "CellarVoice",
  url: "github.com/k/cellarvoice",
  active: true,
  model: "sonnet",
  monitored: false,
};
const wellarita: Repo = {
  id: "r2",
  name: "Wellarita",
  url: "github.com/k/wellarita",
  active: false,
  model: "sonnet",
  monitored: false,
};
// Wellarita steht zuerst, damit die Vorauswahl-Tests die gespeicherte Wahl
// (nicht bloß den Default "erstes Repo") beweisen.
const repos: Repo[] = [wellarita, cellarVoice];

let stateCalls: { method: string; body?: unknown }[];
let activeRepoId: string | null;

beforeEach(() => {
  stateCalls = [];
  activeRepoId = null;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/chat/state" && (!init || init.method === undefined)) {
      stateCalls.push({ method: "GET" });
      return { ok: true, json: async () => ({ activeRepoId }) };
    }
    if (url === "/api/chat/state" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      stateCalls.push({ method: "POST", body });
      activeRepoId = body.repoId;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

describe("Chat (req-040)", () => {
  it("AC: zeigt eine Repo-Auswahl mit allen Repos, auch inaktiven, und ein leeres Eingabefeld", () => {
    render(<Chat repos={repos} />);
    const select = screen.getByRole("combobox", { name: "Repo" });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Wellarita", "CellarVoice"]);
    expect(select).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Nachricht" });
    expect(input).toHaveValue("");
  });

  it("AC: ohne vorherige Sitzung bleibt das erste Repo vorausgewählt", async () => {
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    expect(screen.getByRole("combobox", { name: "Repo" })).toHaveValue("r2");
  });

  it("AC: zuletzt mit CellarVoice gearbeitet — beim erneuten Öffnen ist CellarVoice vorausgewählt", async () => {
    activeRepoId = "r1"; // CellarVoice war beim letzten Mal offen
    render(<Chat repos={repos} />);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Repo" })).toHaveValue("r1"),
    );
  });

  it("AC: wähle ich ein anderes Repo, wird es als zuletzt genutzt gespeichert", async () => {
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    const select = screen.getByRole("combobox", { name: "Repo" });
    await userEvent.selectOptions(select, "CellarVoice");
    await waitFor(() =>
      expect(stateCalls).toContainEqual({ method: "POST", body: { repoId: "r1" } }),
    );
  });
});
