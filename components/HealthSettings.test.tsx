import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_HEALTH_SETTINGS } from "@/lib/health-settings";
import { HealthSettings } from "./HealthSettings";

// req-033: der Schalter für die Telegram-Meldungen sitzt in denselben
// Einstellungen wie die Überwachung — und lässt sie in Ruhe.

let saved: unknown[];

function stubApi(initial = DEFAULT_HEALTH_SETTINGS) {
  saved = [];
  let current = initial;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      current = JSON.parse(String(init.body));
      saved.push(current);
    }
    return { ok: true, json: async () => ({ settings: current }) };
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("HealthSettings — Telegram-Meldungen", () => {
  it("AC: der Schalter schaltet nur die Meldungen ab, nicht die Prüfungen", async () => {
    stubApi();
    render(<HealthSettings />);

    const telegram = await screen.findByRole("switch", { name: "Telegram-Meldungen" });
    await waitFor(() => expect(telegram).toHaveAttribute("aria-checked", "true"));

    await userEvent.click(telegram);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      telegram: false,
      checks: DEFAULT_HEALTH_SETTINGS.checks,
      intervalMinutes: DEFAULT_HEALTH_SETTINGS.intervalMinutes,
    });
    expect(telegram).toHaveAttribute("aria-checked", "false");
  });

  it("zeigt den gespeicherten Stand — abgeschaltet bleibt abgeschaltet", async () => {
    stubApi({ ...DEFAULT_HEALTH_SETTINGS, telegram: false });
    render(<HealthSettings />);

    const telegram = await screen.findByRole("switch", { name: "Telegram-Meldungen" });
    await waitFor(() => expect(telegram).toHaveAttribute("aria-checked", "false"));
  });

  it("die Schalter der Prüfarten sind davon unberührt", async () => {
    stubApi();
    render(<HealthSettings />);

    const container = await screen.findByRole("switch", { name: "Prüfart Container" });
    await userEvent.click(container);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ telegram: true });
    expect((saved[0] as { checks: Record<string, boolean> }).checks.container).toBe(false);
  });
});
