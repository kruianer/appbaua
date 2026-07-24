import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";

// Einstellungsseite / "Verlauf-Log löschen" (req-007). The log lives behind
// /api/run-log, so the component is driven against a stubbed fetch here.

const CONFIRM_TEXT =
  "Gesamten Verlauf wirklich löschen? Das lässt sich nicht rückgängig machen.";

let total: number;
let requests: { url: string; method: string }[];

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data };
}

/** Fake API: GET reports the current count, DELETE wipes it. */
function stubApi() {
  requests = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET" });
    if (init?.method === "DELETE") {
      total = 0;
      return jsonResponse({ total: 0 });
    }
    return jsonResponse({ entries: [], total, page: 0, hasMore: false });
  });
}

const deleteCalls = () => requests.filter((r) => r.method === "DELETE");

beforeEach(() => {
  total = 5;
  stubApi();
});

describe("Einstellungen — Verlauf-Log löschen", () => {
  it("AC: shows the current entry count and the delete button", async () => {
    render(<Settings />);
    expect(
      await screen.findByText("Aktuell 5 Einträge im Verlauf"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verlauf-Log löschen" }),
    ).toBeInTheDocument();
  });

  it("shows the placeholder hint for further settings", async () => {
    render(<Settings />);
    expect(
      await screen.findByText("weitere Einstellungen folgen"),
    ).toBeInTheDocument();
  });

  it("AC: clicking the button opens the confirmation first", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("Aktuell 5 Einträge im Verlauf");

    expect(screen.queryByText(CONFIRM_TEXT)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Verlauf-Log löschen" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(CONFIRM_TEXT)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Abbrechen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0); // nothing deleted yet
  });

  it("AC: cancelling deletes nothing", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("Aktuell 5 Einträge im Verlauf");

    await user.click(
      screen.getByRole("button", { name: "Verlauf-Log löschen" }),
    );
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
    expect(total).toBe(5);
    expect(
      screen.getByText("Aktuell 5 Einträge im Verlauf"),
    ).toBeInTheDocument();
  });

  it("AC: confirming clears the log and shows 'Verlauf gelöscht'", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("Aktuell 5 Einträge im Verlauf");

    await user.click(
      screen.getByRole("button", { name: "Verlauf-Log löschen" }),
    );
    await user.click(screen.getByRole("button", { name: "Löschen" }));

    expect(await screen.findByText("Verlauf gelöscht")).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].url).toBe("/api/run-log");
    expect(total).toBe(0);
    await waitFor(() =>
      expect(
        screen.getByText("Aktuell 0 Einträge im Verlauf"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
