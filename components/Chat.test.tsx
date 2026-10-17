import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";
import type { Repo } from "@/lib/repos";
import type { ChatMessage } from "@/lib/chat-session-store";

// req-040: der Chat-Tab — Repo-Auswahl (auch inaktive Repos), ein leeres
// Eingabefeld, die Vorauswahl des zuletzt genutzten Repos (AC3), das Senden
// einer Nachricht mit Claudes Antwort im Gespräch (AC4) und die
// Unabhängigkeit der Gespräche verschiedener Repos voneinander (AC5/AC6).

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
let messagesByRepo: Record<string, ChatMessage[]>;
/** Hält eine Antwort künstlich zurück, bis das Flag auf true gesetzt wird. */
let releaseAnswer: Record<string, boolean>;

function nextId(repoId: string): number {
  return (messagesByRepo[repoId]?.length ?? 0) + 1;
}

beforeEach(() => {
  stateCalls = [];
  activeRepoId = null;
  messagesByRepo = { r1: [], r2: [] };
  releaseAnswer = { r1: true, r2: true };
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
    const messagesMatch = url.match(/^\/api\/chat\/(\w+)\/messages$/);
    if (messagesMatch && (!init || init.method === undefined)) {
      const repoId = messagesMatch[1];
      const list = messagesByRepo[repoId] ?? [];
      // Die Antwort (letzte Nachricht) erscheint erst, wenn freigegeben —
      // simuliert einen noch laufenden Claude-Lauf.
      const visible =
        releaseAnswer[repoId] || list.length === 0 || list[list.length - 1].role === "user"
          ? list
          : list.slice(0, -1);
      return { ok: true, json: async () => ({ messages: visible }) };
    }
    if (messagesMatch && init?.method === "POST") {
      const repoId = messagesMatch[1];
      const { content } = JSON.parse(String(init.body));
      const userMsg: ChatMessage = {
        id: nextId(repoId),
        repoId,
        role: "user",
        content,
        createdAt: "t",
      };
      messagesByRepo[repoId] = [...(messagesByRepo[repoId] ?? []), userMsg];
      const answerMsg: ChatMessage = {
        id: nextId(repoId),
        repoId,
        role: "assistant",
        content: `Antwort auf: ${content}`,
        createdAt: "t",
      };
      messagesByRepo[repoId] = [...messagesByRepo[repoId], answerMsg];
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

  it("AC4: schicke ich eine Nachricht, steht Claudes Antwort im Gespräch", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");
    const input = screen.getByRole("textbox", { name: "Nachricht" });
    await user.type(input, "Welche Bugs liegen in ready?");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    await waitFor(() =>
      expect(screen.getByText("Antwort auf: Welche Bugs liegen in ready?")).toBeInTheDocument(),
    );
    expect(screen.getByText("Welche Bugs liegen in ready?")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("AC5: läuft in CellarVoice noch eine Antwort, kann ich in Wellarita sofort schreiben und senden", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false; // CellarVoices Antwort "läuft noch"
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");
    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage an CellarVoice");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    // CellarVoice wartet jetzt auf die (zurückgehaltene) Antwort.
    await waitFor(() => expect(screen.getByText("Claude schreibt …")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "Wellarita");
    // Wellarita ist unberührt von CellarVoices laufender Antwort.
    expect(screen.queryByText("Claude schreibt …")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled(); // leeres Feld, nicht "busy"

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage an Wellarita");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(screen.getByText("Antwort auf: Frage an Wellarita")).toBeInTheDocument(),
    );
  });

  it("AC6: nach einer abgewarteten Antwort bleibt das Gespräch beim Zurückschalten unverändert", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");
    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage an CellarVoice");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(screen.getByText("Antwort auf: Frage an CellarVoice")).toBeInTheDocument(),
    );

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "Wellarita");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await waitFor(() =>
      expect(screen.getByText("Antwort auf: Frage an CellarVoice")).toBeInTheDocument(),
    );
    expect(screen.getByText("Frage an CellarVoice")).toBeInTheDocument();
    expect(screen.queryByText("Claude schreibt …")).not.toBeInTheDocument();
  });
});

// req-041 AC11-13: ab 744px wird die Repo-Auswahl zur ständig sichtbaren
// linken Spalte, rechts steht das Gespräch — über die Prop `split`, die
// AppShell ab dieser Breite setzt.
describe("Chat zweispaltig (req-041 AC11-13)", () => {
  it("AC11: links steht eine Liste aller Repos, rechts das Gespräch des gewählten Repos", async () => {
    render(<Chat repos={repos} split />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    expect(screen.queryByRole("combobox", { name: "Repo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wellarita" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CellarVoice" })).toBeInTheDocument();
    // Wellarita ist vorausgewählt (erstes Repo ohne gespeicherte Sitzung).
    expect(document.querySelector("[data-chat-active-repo]")).toHaveTextContent(
      "Wellarita",
    );
  });

  it("AC12: ein Klick auf Wellarita in der Liste zeigt rechts das Gespräch von Wellarita", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} split />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: "CellarVoice" }));
    await waitFor(() =>
      expect(document.querySelector("[data-chat-active-repo]")).toHaveTextContent(
        "CellarVoice",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Wellarita" }));
    await waitFor(() =>
      expect(document.querySelector("[data-chat-active-repo]")).toHaveTextContent(
        "Wellarita",
      ),
    );
  });

  it("AC13: das Gespräch bleibt lesbar schmal statt über die volle Breite gezogen", async () => {
    render(<Chat repos={repos} split />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    const messages = document.querySelector("[data-chat-messages]") as HTMLElement;
    expect(messages.style.maxWidth).toBe("760px");
  });
});
