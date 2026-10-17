import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chat } from "./Chat";
import type { Repo } from "@/lib/repos";

// req-040: der Chat-Tab beim allerersten Öffnen — Repo-Auswahl (auch
// inaktive Repos) und ein leeres Eingabefeld.

const repos: Repo[] = [
  { id: "r1", name: "CellarVoice", url: "github.com/k/cellarvoice", active: true, model: "sonnet", monitored: false },
  { id: "r2", name: "Wellarita", url: "github.com/k/wellarita", active: false, model: "sonnet", monitored: false },
];

describe("Chat (req-040)", () => {
  it("AC: zeigt eine Repo-Auswahl mit allen Repos, auch inaktiven, und ein leeres Eingabefeld", () => {
    render(<Chat repos={repos} />);
    const select = screen.getByRole("combobox", { name: "Repo" });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["CellarVoice", "Wellarita"]);
    expect(select).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Nachricht" });
    expect(input).toHaveValue("");
  });
});
