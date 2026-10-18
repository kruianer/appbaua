import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat, MAX_COMPOSER_HEIGHT_PX } from "./Chat";
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
/** Jedes Repo, für das der Stopp-Knopf einen Abbruch angefragt hat (bug-030). */
let cancelCalls: string[];
/** Simuliert getChatSteps() je Repo (req-048) — wie die Steps-Route es liefert. */
let stepsByRepo: Record<string, string | null>;

function nextId(repoId: string): number {
  return (messagesByRepo[repoId]?.length ?? 0) + 1;
}

// bug-030: jsdom layoutet nicht, scrollHeight ist dort sonst immer 0. Ein Test
// kann den Wert setzen, den das Eingabefeld für seinen Inhalt "messen" würde.
let mockScrollHeight = 20;
Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return mockScrollHeight;
  },
});

beforeEach(() => {
  stateCalls = [];
  activeRepoId = null;
  messagesByRepo = { r1: [], r2: [] };
  releaseAnswer = { r1: true, r2: true };
  cancelCalls = [];
  stepsByRepo = { r1: null, r2: null };
  mockScrollHeight = 20;
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
    const cancelMatch = url.match(/^\/api\/chat\/(\w+)\/cancel$/);
    if (cancelMatch && init?.method === "POST") {
      const repoId = cancelMatch[1];
      cancelCalls.push(repoId);
      // Simuliert, was sendChatMessage nach einem Abbruch selbst ins Gespräch
      // schreibt: eine Systemnachricht statt der (nie gekommenen) Antwort.
      const abortMsg: ChatMessage = {
        id: nextId(repoId),
        repoId,
        role: "system",
        content: "Abgebrochen.",
        createdAt: "t",
      };
      messagesByRepo[repoId] = [...(messagesByRepo[repoId] ?? []), abortMsg];
      releaseAnswer[repoId] = true;
      return { ok: true, json: async () => ({ ok: true, cancelled: true }) };
    }
    const stepsMatch = url.match(/^\/api\/chat\/(\w+)\/steps$/);
    if (stepsMatch && (!init || init.method === undefined)) {
      const repoId = stepsMatch[1];
      return { ok: true, json: async () => ({ steps: stepsByRepo[repoId] ?? null }) };
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

describe("Kopierfeld für Befehle (bug-031)", () => {
  it("zeigt einen im Nachrichtentext enthaltenen Befehl als eigenes Kopierfeld mit Knopf", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    messagesByRepo.r2 = [
      {
        id: 1,
        repoId: "r2",
        role: "system",
        content:
          "Anmeldung abgelaufen. Im Worker-Container dieser Umgebung neu anmelden:\n\n```\ndocker exec -it appbaua-dev-worker-1 claude login\n```",
        createdAt: "t",
      },
    ];

    render(<Chat repos={repos} />);

    await waitFor(() =>
      expect(screen.getByText("docker exec -it appbaua-dev-worker-1 claude login")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Anmeldung abgelaufen. Im Worker-Container dieser Umgebung neu anmelden:"),
    ).toBeInTheDocument();

    const copyButton = screen.getByRole("button", { name: "Befehl kopieren" });
    await userEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith(
      "docker exec -it appbaua-dev-worker-1 claude login",
    );
    expect(screen.getByRole("button", { name: "Befehl kopieren" })).toHaveTextContent("Kopiert");
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

// bug-030: das Eingabefeld ist auf einen Satz gebaut gewesen — hier wachsen,
// Enter-zum-Senden und der Stopp-Knopf für einen laufenden Lauf.
describe("Eingabefeld und Abbrechen (bug-030)", () => {
  it("AC: das Feld wächst mit dem Text, bis zur Grenze — danach rollt es statt weiter zu wachsen", async () => {
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    const input = screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement;

    mockScrollHeight = 80; // mehrzeilig, aber unter der Grenze
    await userEvent.type(input, "mehrzeilig");
    await waitFor(() => expect(input.style.height).toBe("80px"));
    expect(input.style.overflowY).toBe("hidden");

    mockScrollHeight = MAX_COMPOSER_HEIGHT_PX + 100; // über der Grenze
    await userEvent.type(input, " und noch mehr");
    await waitFor(() => expect(input.style.height).toBe(`${MAX_COMPOSER_HEIGHT_PX}px`));
    expect(input.style.overflowY).toBe("auto");
  });

  it("AC: Enter schickt die Nachricht ab", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    const input = screen.getByRole("textbox", { name: "Nachricht" });
    await user.type(input, "Hallo{Enter}");

    await waitFor(() =>
      expect(screen.getByText("Antwort auf: Hallo")).toBeInTheDocument(),
    );
    expect(input).toHaveValue("");
  });

  it("AC: Umschalt+Enter fügt einen Zeilenumbruch ein, statt abzuschicken", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    const input = screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement;
    await user.type(input, "Zeile eins{Shift>}{Enter}{/Shift}Zeile zwei");

    expect(input.value).toBe("Zeile eins\nZeile zwei");
    expect(screen.queryByText(/Antwort auf:/)).not.toBeInTheDocument();
  });

  it("AC: während eine Antwort läuft, steht dort ein Stopp-Knopf statt Senden", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false; // CellarVoices Antwort "läuft noch"
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage an CellarVoice");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveTextContent("Stopp");
    expect(screen.queryByRole("button", { name: "Senden" })).not.toBeInTheDocument();
  });

  it("AC: ein Druck auf Stopp beendet den Lauf; das bisher Gesagte bleibt stehen, und ich kann sofort weiterschreiben", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage an CellarVoice");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(cancelCalls).toEqual(["r1"]);

    // Die bereits gesendete Frage bleibt im Gespräch stehen.
    expect(screen.getByText("Frage an CellarVoice")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Abgebrochen.")).toBeInTheDocument());

    // Sofort wieder bedienbar: Senden-Knopf statt Stopp, Feld nicht blockiert.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Senden" })).toBeInTheDocument(),
    );
    const input = screen.getByRole("textbox", { name: "Nachricht" });
    await user.type(input, "weiter geht's");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(screen.getByText("Antwort auf: weiter geht's")).toBeInTheDocument(),
    );
  });
});

// req-048: während Claude arbeitet, zeigt der Chat dieselben Schritte
// (gelesene Dateien, ausgeführte Befehle), die der Worker über
// onOutput/describeEvent schon zeigt — hier über die neue Steps-Route.
describe("sichtbare Schritte (req-048)", () => {
  it("AC1: zeigt, dass Claude eine Datei liest", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: lib/foo.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Was steht in foo.ts?");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    await waitFor(() => expect(screen.getByText("→ Read: lib/foo.ts")).toBeInTheDocument());
  });

  it("AC2: zeigt einen ausgeführten Befehl", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Bash: npm test";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Laufen die Tests?");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    await waitFor(() => expect(screen.getByText("→ Bash: npm test")).toBeInTheDocument());
  });

  it("AC3: neue Schritte kommen von selbst dazu, ohne dass ich etwas tun muss", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    // Der Stand ändert sich serverseitig, OHNE dass hier etwas getan wird —
    // der nächste Poll-Tick (POLL_MS) muss das von selbst aufgreifen.
    stepsByRepo.r1 = "→ Read: a.ts\n→ Bash: npm test";
    await waitFor(
      () => expect(screen.getByText(/→ Bash: npm test/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("AC6: beim Zurückschalten auf ein Repo mit laufendem Zug sehe ich den aktuellen Stand", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    // Weg zu Wellarita und zurück — zwischendurch läuft CellarVoice weiter.
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "Wellarita");
    stepsByRepo.r1 = "→ Read: a.ts\n→ Bash: npm test";
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await waitFor(() => expect(screen.getByText(/→ Bash: npm test/)).toBeInTheDocument());
  });

  it("AC7: nach einem Stopp bleiben die bis dahin gezeigten Schritte stehen", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Bash: npm test";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("→ Bash: npm test")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.getByText("Abgebrochen.")).toBeInTheDocument());

    expect(screen.getByText("→ Bash: npm test")).toBeInTheDocument();
  });
});
