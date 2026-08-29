import { describe, it, expect } from "vitest";
import type { AppHealth, CheckKind, CheckResult, CheckStatus } from "./health";
import {
  type AlertState,
  ALERT_AFTER_FAILS,
  alertKey,
  normalizeAlertState,
  planAlerts,
} from "./telegram-alerts";

// req-033, der Kern: WANN eine Nachricht fällig ist. Ein Fehlalarm nervt, eine
// verschluckte Meldung ist der Ausfall, von dem man nichts erfährt — deshalb
// wird hier jede der vier Meldungs-Regeln einzeln durchgespielt.

function check(
  status: CheckStatus,
  at: string | null,
  detail = "lgt-prod-monitoring-watchdog (Neustart-Schleife)",
  kind: CheckKind = "container",
): CheckResult {
  return { kind, status, detail, checkedAt: at };
}

function app(checks: CheckResult[], over: Partial<AppHealth> = {}): AppHealth {
  return {
    repoId: "r1",
    repoName: "LivingGardenTwin",
    repoUrl: "github.com/kruianer/livinggardentwin",
    lamp: "red",
    checks,
    checkedAt: checks[0]?.checkedAt ?? null,
    ...over,
  };
}

/** Eine Prüfrunde: Ergebnis rein, Nachrichten und neuer Zustand raus. */
function round(
  state: AlertState,
  status: CheckStatus,
  at: string,
  detail?: string,
) {
  return planAlerts([app([check(status, at, detail)])], state);
}

const T = (minutes: number) =>
  new Date(Date.UTC(2026, 7, 29, 12, minutes)).toISOString();

describe("planAlerts — melden oder still bleiben", () => {
  it("AC: ein einzelner Fehlschlag löst noch keine Nachricht aus", () => {
    const first = round({}, "fail", T(0));
    expect(first.alerts).toEqual([]);
    expect(first.state[alertKey("r1", "container")].fails).toBe(1);
  });

  it("AC: beim zweiten Fehlschlag in Folge kommt genau eine Nachricht — mit App, Prüfung und Grund", () => {
    const first = round({}, "fail", T(0));
    const second = round(first.state, "fail", T(5));

    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0].kind).toBe("down");
    expect(second.alerts[0].text).toContain("LivingGardenTwin");
    expect(second.alerts[0].text).toContain("Container");
    expect(second.alerts[0].text).toContain("lgt-prod-monitoring-watchdog (Neustart-Schleife)");
  });

  it("AC: einmal rot, beim zweiten Mal wieder in Ordnung — KEINE Nachricht", () => {
    const first = round({}, "fail", T(0));
    const second = round(first.state, "ok", T(5), "3 Container laufen");

    expect(second.alerts).toEqual([]);
    expect(second.state[alertKey("r1", "container")].fails).toBe(0);
  });

  it("AC: steht die Prüfung stundenlang auf Rot, kommt KEINE weitere Nachricht", () => {
    let state = round({}, "fail", T(0)).state;
    state = round(state, "fail", T(5)).state; // hier kam die eine Meldung

    for (const minute of [10, 15, 20, 25, 30]) {
      const next = round(state, "fail", T(minute));
      expect(next.alerts).toEqual([]);
      state = next.state;
    }
    expect(state[alertKey("r1", "container")].alerted).toBe(true);
  });

  it("AC: ist die gemeldete Prüfung wieder in Ordnung, kommt genau eine Entwarnung", () => {
    let state = round({}, "fail", T(0)).state;
    state = round(state, "fail", T(5)).state;

    const recovered = round(state, "ok", T(10), "3 Container laufen");
    expect(recovered.alerts).toHaveLength(1);
    expect(recovered.alerts[0].kind).toBe("up");
    expect(recovered.alerts[0].text).toContain("wieder in Ordnung");
    expect(recovered.alerts[0].text).toContain("3 Container laufen");

    // und danach ist Ruhe
    const still = round(recovered.state, "ok", T(15), "3 Container laufen");
    expect(still.alerts).toEqual([]);
  });

  it("nach der Entwarnung braucht es wieder zwei Fehlschläge", () => {
    let state = round({}, "fail", T(0)).state;
    state = round(state, "fail", T(5)).state;
    state = round(state, "ok", T(10)).state;

    expect(round(state, "fail", T(15)).alerts).toEqual([]);
    state = round(state, "fail", T(15)).state;
    expect(round(state, "fail", T(20)).alerts).toHaveLength(1);
  });

  it("dasselbe Ergebnis noch einmal gelesen zählt NICHT als zweite Runde", () => {
    // So sieht es aus, wenn die Prüfart noch nicht wieder fällig war: die Runde
    // übernimmt das alte Ergebnis samt seinem Zeitstempel (health-checks.ts).
    const first = round({}, "fail", T(0));
    const again = round(first.state, "fail", T(0));

    expect(again.alerts).toEqual([]);
    expect(again.state[alertKey("r1", "container")].fails).toBe(1);
  });

  it("eine Prüfung, die nicht laufen konnte, zählt weder hoch noch entwarnt sie", () => {
    const first = round({}, "fail", T(0));

    for (const status of ["unknown", "unconfigured", "off"] as CheckStatus[]) {
      const next = round(first.state, status, T(5));
      expect(next.alerts).toEqual([]);
      expect(next.state[alertKey("r1", "container")].fails).toBe(1);
    }
  });

  it("eine abgeschaltete Prüfart hält eine offene Meldung, bis sie wieder ok ist", () => {
    let state = round({}, "fail", T(0)).state;
    state = round(state, "fail", T(5)).state;
    state = round(state, "off", T(10)).state;

    const recovered = round(state, "ok", T(15), "3 Container laufen");
    expect(recovered.alerts.map((a) => a.kind)).toEqual(["up"]);
  });

  it("jede Prüfart wird für sich bewertet", () => {
    const results = [
      app([
        check("fail", T(0), "Container weg", "container"),
        check("fail", T(0), "keine Antwort", "web"),
      ]),
    ];
    const first = planAlerts(results, {});
    const second = planAlerts(
      [
        app([
          check("fail", T(5), "Container weg", "container"),
          check("ok", T(5), "dev: 307", "web"),
        ]),
      ],
      first.state,
    );

    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0].check).toBe("container");
  });

  it("ein Repo, das nicht mehr überwacht wird, verschwindet aus dem Zustand", () => {
    const first = round({}, "fail", T(0));
    const gone = planAlerts([], first.state);

    expect(gone.alerts).toEqual([]);
    expect(gone.state).toEqual({});
  });

  it("die Schwelle ist zwei — das ist es, was req-033 verlangt", () => {
    expect(ALERT_AFTER_FAILS).toBe(2);
  });
});

describe("normalizeAlertState", () => {
  it("macht aus gespeichertem JSON einen brauchbaren Zustand", () => {
    const state = normalizeAlertState({
      "r1:container": { fails: 3, alerted: true, at: "2026-08-29T12:00:00.000Z" },
    });
    expect(state["r1:container"]).toEqual({
      fails: 3,
      alerted: true,
      at: "2026-08-29T12:00:00.000Z",
    });
  });

  it("verwirft Unsinn, statt daran zu scheitern", () => {
    expect(normalizeAlertState(null)).toEqual({});
    expect(normalizeAlertState("kaputt")).toEqual({});
    expect(normalizeAlertState({ "r1:web": { fails: "viele" } })).toEqual({
      "r1:web": { fails: 0, alerted: false, at: null },
    });
  });
});
