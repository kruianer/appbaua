import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat, MAX_COMPOSER_HEIGHT_PX, formatElapsed } from "./Chat";
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
/** Simuliert isChatTurnRunning() je Repo (bug-038). */
let runningByRepo: Record<string, boolean>;

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
  runningByRepo = {};
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
      // schreibt: eine Systemnachricht statt der (nie gekommenen) Antwort —
      // mit den bis dahin gezeigten Schritten dran (req-049 AC6).
      const abortMsg: ChatMessage = {
        id: nextId(repoId),
        repoId,
        role: "system",
        content: "Abgebrochen.",
        createdAt: "t",
        steps: stepsByRepo[repoId] ?? undefined,
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
      const lastIsAnswer = list.length > 0 && list[list.length - 1].role !== "user";
      // Die Antwort (letzte Nachricht) erscheint erst, wenn freigegeben —
      // simuliert einen noch laufenden Claude-Lauf.
      const visible = releaseAnswer[repoId] || list.length === 0 || !lastIsAnswer
        ? list
        : list.slice(0, -1);
      // req-049: wie der echte Server werden die Schritte DIESES Zugs einmalig,
      // beim ersten Sichtbarwerden der Antwort, dauerhaft an ihr festgemacht —
      // eine spätere Änderung von stepsByRepo darf eine schon gezeigte Antwort
      // nicht nachträglich umschreiben (jede Frage behält ihre EIGENEN Schritte).
      if (releaseAnswer[repoId] && lastIsAnswer) {
        const last = list[list.length - 1];
        if (last.steps === undefined) {
          list[list.length - 1] = { ...last, steps: stepsByRepo[repoId] ?? undefined };
        }
      }
      return { ok: true, json: async () => ({ messages: visible, running: runningByRepo[repoId] ?? (lastIsAnswer && !releaseAnswer[repoId]) }) };
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

  it("AC13: eine einzelne Nachricht bleibt lesbar schmal statt über die volle Breite gezogen", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} split />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "CellarVoice" }));

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("Frage")).toBeInTheDocument());

    // Zeile -> Sprechblase -> der äußere Wrapper, der die Lesebreite trägt.
    const bubbleWrapper = screen.getByText("Frage").parentElement?.parentElement as HTMLElement;
    expect(bubbleWrapper.style.maxWidth).toBe("min(760px, 88%)");
  });
});

// bug-033: fünf Darstellungsmängel des Chats — die Breite des
// Gesprächsbereichs selbst (statt der einzelnen Nachricht), der Abstand zum
// Eingabefeld und ein Lebenszeichen, das nicht vom Ereignisstrom abhängt.
describe("Darstellung (bug-033)", () => {
  it("AC1: der Gesprächsbereich selbst nutzt die volle Breite statt einer festen Höchstbreite", async () => {
    render(<Chat repos={repos} split />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    const messages = document.querySelector("[data-chat-messages]") as HTMLElement;
    expect(messages.style.maxWidth).toBe("");
    expect(messages.style.width).toBe("");
  });

  it("AC3: am unteren Rand des Gesprächsbereichs bleibt Luft zum Eingabefeld", async () => {
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    const messages = document.querySelector("[data-chat-messages]") as HTMLElement;
    expect(Number.parseInt(messages.style.paddingBottom, 10)).toBeGreaterThan(0);
  });

  it("AC4: solange eine Antwort läuft, zeigt das Lebenszeichen eine verstrichene Zeit statt stehenzubleiben", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    const lifeSign = () => document.querySelector("[data-chat-life-sign]") as HTMLElement;
    await waitFor(() => expect(lifeSign().textContent).toMatch(/seit 0:0\d/));

    const first = lifeSign().textContent;
    await waitFor(() => expect(lifeSign().textContent).not.toBe(first), { timeout: 3000 });
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
// req-049 liest die Schritte wie in VS Code: untereinander, in normaler
// Schriftgröße, ohne eigenen Rollbalken — und ersetzt damit req-048s
// schmalen Kasten/eingeklappten Zustand komplett (siehe die beiden Tests
// weiter unten, die das alte Verhalten durch das neue ersetzen).
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

  it("AC6 (req-049): ist die Antwort fertig, stehen die Schritte weiterhin unverändert da statt eingeklappt zu sein", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    releaseAnswer.r1 = true;
    await waitFor(
      () => expect(screen.getByText(/Antwort auf: Frage/)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Kein <details> mehr — der Schritt steht direkt und ungeklickt da.
    expect(document.querySelector("details[data-chat-steps]")).not.toBeInTheDocument();
    expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument();
  });

  it("AC1/AC2 (req-049): die Schritte stehen in normaler Schriftgröße ohne eigenen Rollbalken", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    const stepsBox = document.querySelector("[data-chat-steps]") as HTMLElement;
    // Dieselbe Schriftgröße wie der Nachrichtentext (14px), nicht der kleine
    // Zusatztext der Oberfläche (10-12px).
    expect(stepsBox.style.fontSize).toBe("14px");
    expect(stepsBox.style.overflowY).toBe("");
    expect(stepsBox.style.maxHeight).toBe("");
  });

  it("AC7 (req-049): die Antwort hebt sich deutlicher ab als die Schritte davor", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    releaseAnswer.r1 = true;
    await waitFor(
      () => expect(screen.getByText(/Antwort auf: Frage/)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    const stepsBox = document.querySelector("[data-chat-steps]") as HTMLElement;
    const answerBubble = screen.getByText(/Antwort auf: Frage/).parentElement as HTMLElement;
    // Die Antwort hat einen eigenen Hintergrund und den vollen Textton, die
    // Schritte bleiben ohne Hintergrund und gedämpft — ein klarer Unterschied.
    expect(answerBubble.style.background).not.toBe("");
    expect(answerBubble.style.color).toBe("var(--color-text)");
    expect(stepsBox.style.background).toBe("");
    expect(stepsBox.style.color).not.toBe("var(--color-text)");
  });

  it("AC8 (req-049): rolle ich zu einer früheren Frage, finde ich auch deren eigene Schritte", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    stepsByRepo.r1 = "→ Read: erste.ts";
    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Erste Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: erste.ts")).toBeInTheDocument());
    releaseAnswer.r1 = true;
    await waitFor(
      () => expect(screen.getByText("Antwort auf: Erste Frage")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: zweite.ts";
    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Zweite Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: zweite.ts")).toBeInTheDocument());
    releaseAnswer.r1 = true;
    await waitFor(
      () => expect(screen.getByText("Antwort auf: Zweite Frage")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Die Schritte der ERSTEN Frage stehen weiterhin an ihrem eigenen Platz —
    // unverändert durch die inzwischen gelaufene zweite Frage.
    expect(screen.getByText("→ Read: erste.ts")).toBeInTheDocument();
    expect(screen.getByText("→ Read: zweite.ts")).toBeInTheDocument();
  });

  it("AC9 (req-049): auf dem iPhone (kein Split) stehen Schritte und Antwort gleichzeitig im Gespräch", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts\n→ Bash: npm test";
    // split=false ist der Default — genau die Darstellung am iPhone.
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Bash: npm test")).toBeInTheDocument());

    releaseAnswer.r1 = true;
    await waitFor(
      () => expect(screen.getByText("Antwort auf: Frage")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Beide stehen zugleich im Gespräch — die Schritte haben die Antwort
    // nicht verdrängt, und der Gesprächsbereich (nicht die Schritte selbst)
    // trägt den einzigen Rollbalken.
    expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument();
    expect(screen.getByText("→ Bash: npm test")).toBeInTheDocument();
    expect(screen.getByText("Antwort auf: Frage")).toBeInTheDocument();
    const messagesEl = document.querySelector("[data-chat-messages]") as HTMLElement;
    expect(messagesEl.style.overflowY).toBe("auto");
    const stepsBox = document.querySelector("[data-chat-steps]") as HTMLElement;
    expect(stepsBox.style.overflowY).toBe("");
  });
});

// bug-034: der Gesprächsbereich rollt selbst mit, wenn man am Ende steht —
// und bleibt stehen, wenn man hochgerollt hat. Außerdem gibt er in der
// Flex-Spalte seinen Platz wirklich frei (min-height: 0), statt bei
// wachsendem Inhalt die Kinder zusammenzudrücken.
describe("Darstellung (bug-034)", () => {
  let mockScrollHeight: number;
  let mockClientHeight: number;

  beforeEach(() => {
    mockScrollHeight = 1000;
    mockClientHeight = 300;
    // jsdom layoutet nicht — scrollHeight/clientHeight sind sonst immer 0.
    // scrollTop bleibt die echte jsdom-Implementierung (lesbar/schreibbar).
    Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return mockScrollHeight;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return mockClientHeight;
      },
    });
  });

  it("AC2: der Gesprächsbereich gibt seinen Platz in der Flex-Spalte frei (min-height: 0)", async () => {
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    const messages = document.querySelector("[data-chat-messages]") as HTMLElement;
    expect(messages.style.minHeight).toBe("0");
  });

  it("AC1: nach dem Abschicken einer Nachricht steht der Gesprächsbereich am Ende", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    const messagesEl = document.querySelector("[data-chat-messages]") as HTMLDivElement;
    messagesEl.scrollTop = 0; // bewusst nicht am Ende, bevor abgeschickt wird

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    await waitFor(() => expect(screen.getByText("Antwort auf: Frage")).toBeInTheDocument());
    expect(messagesEl.scrollTop).toBe(mockScrollHeight);
  });

  it("AC1: während die Schritte wachsen, bleibt die Ansicht am Ende", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    const messagesEl = document.querySelector("[data-chat-messages]") as HTMLDivElement;
    expect(messagesEl.scrollTop).toBe(mockScrollHeight);

    mockScrollHeight = 1400; // die Schritte sind gewachsen, der Bereich damit höher
    stepsByRepo.r1 = "→ Read: a.ts\n→ Bash: npm test";
    await waitFor(
      () => expect(screen.getByText(/→ Bash: npm test/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    await waitFor(() => expect(messagesEl.scrollTop).toBe(mockScrollHeight));
  });

  it("AC1 Ausnahme: nach oben gerollt, reißt ein wachsender Schritt die Ansicht nicht ans Ende", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    const messagesEl = document.querySelector("[data-chat-messages]") as HTMLDivElement;
    // Nach oben gerollt, um die bisherigen Schritte zu lesen.
    messagesEl.scrollTop = 0;
    fireEvent.scroll(messagesEl);

    stepsByRepo.r1 = "→ Read: a.ts\n→ Bash: npm test";
    await waitFor(
      () => expect(screen.getByText(/→ Bash: npm test/)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(messagesEl.scrollTop).toBe(0);
  });
});

// bug-036: das Schritte-Feld ist ein direktes Flex-Kind des (mitrollenden)
// Gesprächsbereichs und wurde dort zusammengedrückt, statt dass das
// Gespräch darüber rollt. flexShrink: 0 stellt sicher, dass es lesbar bleibt
// (req-049 ersetzt die frühere Mindesthöhe/Höchsthöhe-Box durch Zeilen ohne
// eigene Größenbeschränkung — siehe die Tests zu req-049 oben).
describe("Darstellung (bug-036)", () => {
  it("AC: das Schritte-Feld schrumpft nicht, wenn das Gespräch darüber wächst", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    stepsByRepo.r1 = "→ Read: a.ts";
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getByText("→ Read: a.ts")).toBeInTheDocument());

    const steps = document.querySelector("[data-chat-steps]") as HTMLElement;
    expect(steps.style.flexShrink).toBe("0");
  });

  it("AC: das Lebenszeichen schrumpft nicht, wenn das Gespräch darüber wächst", async () => {
    const user = userEvent.setup();
    releaseAnswer.r1 = false;
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Frage");
    await user.click(screen.getByRole("button", { name: "Senden" }));

    const lifeSign = document.querySelector("[data-chat-life-sign]") as HTMLElement;
    await waitFor(() => expect(lifeSign.style.flexShrink).toBe("0"));
  });

  it("AC: die einzelnen Nachrichten schrumpfen nicht — das Gespräch rollt stattdessen", async () => {
    const user = userEvent.setup();
    render(<Chat repos={repos} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Hallo{Enter}");
    await waitFor(() => expect(screen.getByText("Antwort auf: Hallo")).toBeInTheDocument());

    // "Hallo" steckt im Textblock, dessen Elternelement die Bubble ist und
    // deren Elternelement wiederum das äußere Nachrichten-Flex-Kind.
    const messageEl = screen.getByText("Hallo").parentElement?.parentElement as HTMLElement;
    expect(messageEl.style.flexShrink).toBe("0");
  });
});

describe("formatElapsed (bug-033 AC4)", () => {
  it("formatiert unter einer Minute als 0:ss", () => {
    expect(formatElapsed(14)).toBe("0:14");
  });

  it("formatiert Minuten und Sekunden wie im Hinweis ('seit 2:14')", () => {
    expect(formatElapsed(134)).toBe("2:14");
  });

  it("rundet ab statt aufzurunden", () => {
    expect(formatElapsed(14.9)).toBe("0:14");
  });
});

describe("Sitzung überlebt den Tab-Wechsel (bug-038)", () => {
  it("eine frisch geöffnete Ansicht zeigt den noch laufenden Zug und holt dessen Antwort", async () => {
    // Der Zug lief schon, bevor diese Ansicht entstand (Tab-Wechsel hat sie neu aufgebaut).
    messagesByRepo.r1 = [
      { id: 1, repoId: "r1", role: "user", content: "Lange Aufgabe", createdAt: "2026-10-21T10:00:00Z" },
    ];
    runningByRepo.r1 = true;
    render(<Chat repos={[cellarVoice, wellarita]} />);
    await waitFor(() => expect(screen.getByText("Claude schreibt …")).toBeInTheDocument());

    // Der Zug endet im Hintergrund.
    messagesByRepo.r1 = [
      ...messagesByRepo.r1,
      { id: 2, repoId: "r1", role: "assistant", content: "Fertig", createdAt: "2026-10-21T10:05:00Z" },
    ];
    runningByRepo.r1 = false;
    await waitFor(() => expect(screen.getByText("Fertig")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByText("Claude schreibt …")).not.toBeInTheDocument();
  });
});

describe("Antwort erscheint von selbst (bug-039)", () => {
  it("die Antwort steht ohne weitere Nachricht da, auch wenn die Nachrichtenzahl vorher schon stimmte", async () => {
    const user = userEvent.setup();
    render(<Chat repos={[cellarVoice, wellarita]} />);
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repo" }), "CellarVoice");

    // Die Antwort läuft noch; der Server meldet running, die Frage steht schon im Gespräch.
    releaseAnswer.r1 = false;
    await user.type(screen.getByRole("textbox", { name: "Nachricht" }), "Drei Rückfragen?");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument(),
    );

    // Der Zug endet im Hintergrund — die Ansicht holt die Antwort selbst.
    releaseAnswer.r1 = true;
    await waitFor(
      () => expect(screen.getByText("Antwort auf: Drei Rückfragen?")).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.queryByText("Claude schreibt …")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senden" })).toBeInTheDocument();
  });
});

// req-050: Favicon je Repo vor dem Namen; Platzhalter, wenn das Bild fehlt.
describe("Favicon je Repo (req-050)", () => {
  const iconOf = (el: HTMLElement) => el.querySelector("[data-repo-icon]");
  const placeholderOf = (el: HTMLElement) => el.querySelector("[data-repo-icon-placeholder]");

  it("AC1: in der Repo-Liste steht das Favicon vor dem Namen", async () => {
    render(<Chat repos={repos} split />);
    const btn = screen.getByRole("button", { name: "CellarVoice" });
    expect(iconOf(btn)).toHaveAttribute("src", "/api/repos/r1/favicon");
    expect(btn.firstElementChild).toBe(iconOf(btn));
  });

  it("AC2/AC3: auf dem Handy zeigen geschlossene und geöffnete Auswahl das Favicon", async () => {
    render(<Chat repos={repos} />);
    const picker = document.querySelector("[data-repo-picker]") as HTMLElement;
    // Wellarita ist vorgewählt.
    expect(iconOf(picker)).toHaveAttribute("src", "/api/repos/r2/favicon");
    await userEvent.click(picker);
    const option = within(screen.getByRole("listbox")).getByRole("option", { name: "CellarVoice" });
    expect(iconOf(option)).toHaveAttribute("src", "/api/repos/r1/favicon");
    await userEvent.click(option);
    expect(iconOf(document.querySelector("[data-repo-picker]") as HTMLElement)).toHaveAttribute(
      "src",
      "/api/repos/r1/favicon",
    );
  });

  it("AC4/AC5/AC7: ohne ladbares Bild steht ein Platzhalter mit Großbuchstaben, überall gleich gefärbt", async () => {
    const lower: Repo = { ...wellarita, id: "r3", name: "alpha", url: "github.com/k/alpha" };
    render(<Chat repos={[wellarita, lower]} split />);
    const a = screen.getByRole("button", { name: "Wellarita" });
    const b = screen.getByRole("button", { name: "alpha" });
    fireEvent.error(iconOf(a)!);
    fireEvent.error(iconOf(b)!);
    expect(iconOf(a)).toBeNull();
    expect(placeholderOf(a)).toHaveTextContent("W");
    expect(placeholderOf(b)).toHaveTextContent("A");
    expect((placeholderOf(a) as HTMLElement).style.background).toBe(
      (placeholderOf(b) as HTMLElement).style.background,
    );
  });
});
