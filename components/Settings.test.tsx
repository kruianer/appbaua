import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";

// Einstellungsseite / "Verlauf-Log löschen" (req-007). The log lives behind
// /api/run-log, so the component is driven against a stubbed fetch here.

const CONFIRM_TEXT =
  "Gesamten Verlauf wirklich löschen? Das lässt sich nicht rückgängig machen.";

let total: number;
let backupStatus: { total: number; remaining: number };
let newBackupCodes: string[];
let requests: { url: string; method: string }[];

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data };
}

/** Fake API: GET reports the current count, DELETE wipes it, /api/auth/me
 * says "not the operator" by default (req-023's invite button stays hidden),
 * /api/auth/backup-codes reports/regenerates the backup-code status (req-031). */
function stubApi() {
  requests = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (url.includes("/api/auth/me")) {
      return jsonResponse({ user: { isOperator: false } });
    }
    if (url.includes("/api/auth/backup-codes")) {
      if (method === "POST") {
        backupStatus = { total: backupStatus.total, remaining: backupStatus.total };
        return jsonResponse({ backupCodes: newBackupCodes });
      }
      return jsonResponse(backupStatus);
    }
    if (init?.method === "DELETE") {
      total = 0;
      return jsonResponse({ total: 0 });
    }
    return jsonResponse({ entries: [], total, page: 0, hasMore: false });
  });
}

const deleteCalls = () => requests.filter((r) => r.method === "DELETE");
const backupCodeCalls = () =>
  requests.filter((r) => r.url.includes("/api/auth/backup-codes"));

beforeEach(() => {
  total = 5;
  backupStatus = { total: 10, remaining: 10 };
  newBackupCodes = Array.from({ length: 10 }, (_, i) => `NEW-CODE-${i}`);
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

  it("req-023: shows an Abmelden button", async () => {
    render(<Settings />);
    expect(
      await screen.findByRole("button", { name: "Abmelden" }),
    ).toBeInTheDocument();
  });

  it("req-023: hides 'Einladung erstellen' for a non-operator user", async () => {
    render(<Settings />);
    await screen.findByRole("button", { name: "Abmelden" });
    expect(
      screen.queryByRole("button", { name: "Einladung erstellen" }),
    ).not.toBeInTheDocument();
  });

  it("req-023 AC5: shows 'Einladung erstellen' only for the operator", async () => {
    requests = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push({ url, method: "GET" });
      if (url.includes("/api/auth/me")) {
        return jsonResponse({ user: { isOperator: true } });
      }
      return jsonResponse({ entries: [], total, page: 0, hasMore: false });
    });
    render(<Settings />);
    expect(
      await screen.findByRole("button", { name: "Einladung erstellen" }),
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

describe("Einstellungen — Backup-Codes neu erzeugen (req-031)", () => {
  it("AC: shows how many of 10 codes are still unused", async () => {
    backupStatus = { total: 10, remaining: 10 };
    render(<Settings />);
    expect(
      await screen.findByText("noch 10 von 10 Codes übrig"),
    ).toBeInTheDocument();
  });

  it("AC: reflects codes already consumed at recovery", async () => {
    backupStatus = { total: 10, remaining: 7 };
    render(<Settings />);
    expect(
      await screen.findByText("noch 7 von 10 Codes übrig"),
    ).toBeInTheDocument();
  });

  it("AC: clicking 'Neue Backup-Codes erzeugen' opens a warning dialog before anything is generated", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("noch 10 von 10 Codes übrig");

    await user.click(
      screen.getByRole("button", { name: /Neue Backup-Codes erzeugen/ }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Die bisherigen Backup-Codes funktionieren danach nicht mehr."),
    ).toBeInTheDocument();
    expect(backupCodeCalls().filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("AC: cancelling the dialog generates nothing", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("noch 10 von 10 Codes übrig");

    await user.click(
      screen.getByRole("button", { name: /Neue Backup-Codes erzeugen/ }),
    );
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backupCodeCalls().filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("AC: confirming shows the 10 new codes in plaintext, once", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("noch 10 von 10 Codes übrig");

    await user.click(
      screen.getByRole("button", { name: /Neue Backup-Codes erzeugen/ }),
    );
    await user.click(screen.getByRole("button", { name: "Erzeugen" }));

    expect(await screen.findByText("NEW-CODE-0")).toBeInTheDocument();
    expect(screen.getByText("NEW-CODE-9")).toBeInTheDocument();
    expect(backupCodeCalls().filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("AC: dismissing the new codes hides them again — only the counter remains", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText("noch 10 von 10 Codes übrig");

    await user.click(
      screen.getByRole("button", { name: /Neue Backup-Codes erzeugen/ }),
    );
    await user.click(screen.getByRole("button", { name: "Erzeugen" }));
    await screen.findByText("NEW-CODE-0");

    await user.click(screen.getByRole("button", { name: "Gesichert — weiter" }));

    expect(screen.queryByText("NEW-CODE-0")).not.toBeInTheDocument();
    expect(
      await screen.findByText("noch 10 von 10 Codes übrig"),
    ).toBeInTheDocument();
  });
});
