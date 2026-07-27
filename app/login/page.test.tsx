import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginPage from "./page";

// req-023: the bug this pins was real — a fresh install had NO visible way to
// reach the operator bootstrap from /login, only "mit Passkey anmelden"
// (fails, no passkey exists yet) and "Backup-Code" (none exist either).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function stubStatus(bootstrapped: boolean) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ bootstrapped }),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginPage — Ersteinrichtungs-Link (req-023 AC1)", () => {
  it("AC: shows the Ersteinrichtung link when no user exists yet", async () => {
    stubStatus(false);
    render(<LoginPage />);
    expect(
      await screen.findByRole("link", { name: "Noch kein Zugang? Ersteinrichtung starten" }),
    ).toHaveAttribute("href", "/register");
  });

  it("AC6: hides the Ersteinrichtung link once an operator already exists — no open self-registration", async () => {
    stubStatus(true);
    render(<LoginPage />);
    await screen.findByRole("button", { name: "Mit Passkey anmelden" });
    expect(
      screen.queryByRole("link", { name: "Noch kein Zugang? Ersteinrichtung starten" }),
    ).not.toBeInTheDocument();
  });

  it("the recovery link is always visible regardless of bootstrap status", async () => {
    stubStatus(false);
    render(<LoginPage />);
    expect(
      await screen.findByRole("link", {
        name: "Zugang verloren? Mit Backup-Code wiederherstellen",
      }),
    ).toHaveAttribute("href", "/recovery");
  });
});
