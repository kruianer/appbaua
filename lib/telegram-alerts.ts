// Wann eine Meldung fällig ist und wie sie klingt (req-033). Reine Logik, kein
// I/O — die Frage "melden oder still bleiben" ist genau die, die falsch zu
// beantworten teuer wäre, und lässt sich hier ohne Telegram durchspielen.
//
// Der Grundsatz: gemeldet wird die ÄNDERUNG, nicht der Zustand. Einmal Rot ist
// noch keine Nachricht (es könnte ein Aussetzer sein), zweimal Rot in Folge
// schon; danach bleibt es still, bis dieselbe Prüfung wieder in Ordnung ist —
// dann kommt genau eine Entwarnung. Ein Dauerausfall erzeugt also zwei
// Nachrichten, nicht eine pro Prüfrunde.

import { type AppHealth, type CheckKind, CHECK_LABELS } from "./health";

/** So oft muss eine Prüfung in Folge fehlschlagen, bevor gemeldet wird. */
export const ALERT_AFTER_FAILS = 2;

/**
 * Was zu einer Prüfung bekannt ist, zwischen den Runden gemerkt.
 *  - `fails`   — wie oft sie zuletzt in Folge fehlschlug;
 *  - `alerted` — ob dazu schon gemeldet wurde und die Entwarnung noch aussteht;
 *  - `at`      — der `checkedAt` der Runde, die hier zuletzt gezählt wurde.
 *
 * `at` ist der Grund, warum ein Ergebnis nicht doppelt zählt: eine Prüfrunde
 * übernimmt für eine noch nicht fällige Prüfart einfach das alte Ergebnis
 * (health-checks.ts). Ohne diesen Vergleich würde jede Runde denselben
 * Fehlschlag erneut zählen, und aus einem Aussetzer würde nach zwei Aufrufen
 * der Zustandsseite eine Meldung.
 */
export type AlertEntry = {
  fails: number;
  alerted: boolean;
  at: string | null;
};

/** Schlüssel ist `${repoId}:${kind}` — eine Prüfung EINER App. */
export type AlertState = Record<string, AlertEntry>;

export type AlertKind = "down" | "up";

export type Alert = {
  kind: AlertKind;
  repoId: string;
  repoName: string;
  check: CheckKind;
  /** Der fertige Text, so wie er im Chat steht. */
  text: string;
};

export function alertKey(repoId: string, kind: CheckKind): string {
  return `${repoId}:${kind}`;
}

/** Was JSON aus dem Speicher hergibt, in eine brauchbare Form. */
export function normalizeAlertState(raw: unknown): AlertState {
  const out: AlertState = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<AlertEntry> | null;
    if (!entry || typeof entry !== "object") continue;
    const fails = Number(entry.fails);
    out[key] = {
      fails: Number.isFinite(fails) && fails > 0 ? Math.floor(fails) : 0,
      alerted: entry.alerted === true,
      at: typeof entry.at === "string" ? entry.at : null,
    };
  }
  return out;
}

function downText(app: AppHealth, kind: CheckKind, detail: string): string {
  return [
    `🔴 ${app.repoName} — ${CHECK_LABELS[kind]} fehlgeschlagen`,
    detail,
  ].join("\n");
}

function upText(app: AppHealth, kind: CheckKind, detail: string): string {
  return [
    `🟢 ${app.repoName} — ${CHECK_LABELS[kind]} wieder in Ordnung`,
    detail,
  ].join("\n");
}

/**
 * Was nach einer Prüfrunde zu melden ist, und was sich appbaua bis zur nächsten
 * Runde merken muss. Reine Funktion: derselbe Zustand plus dasselbe Ergebnis
 * ergeben immer dieselben Nachrichten.
 *
 * Bewertet wird je Prüfung EINER App:
 *  - `fail`  — zählt hoch; beim Erreichen von ALERT_AFTER_FAILS genau eine
 *              Meldung, danach nichts mehr, solange es rot bleibt;
 *  - `ok`    — setzt zurück; stand eine Meldung offen, kommt die Entwarnung;
 *  - sonst   — `unbekannt`, `nicht konfiguriert`, `abgeschaltet`: die Prüfung
 *              hat NICHTS festgestellt. Sie zählt weder hoch noch entwarnt sie;
 *              der Stand bleibt, wie er war (dieselbe Trennung, die die
 *              Zustandsseite zwischen Rot und Unbekannt macht, req-032).
 *
 * Ein Repo, das nicht mehr überwacht wird, verschwindet aus dem Zustand — sonst
 * käme nach dem Wiedereinschalten eine Entwarnung zu einem Ausfall, über den
 * inzwischen niemand mehr etwas wissen will.
 */
export function planAlerts(
  results: AppHealth[],
  state: AlertState,
): { alerts: Alert[]; state: AlertState } {
  const next: AlertState = {};
  const alerts: Alert[] = [];

  for (const app of results) {
    for (const check of app.checks) {
      const key = alertKey(app.repoId, check.kind);
      const prev: AlertEntry = state[key] ?? { fails: 0, alerted: false, at: null };

      // Dasselbe Ergebnis wie beim letzten Mal: diese Prüfung lief in dieser
      // Runde gar nicht, sie war nur noch nicht fällig.
      const ran = check.status === "ok" || check.status === "fail";
      if (!ran || check.checkedAt === prev.at) {
        next[key] = prev;
        continue;
      }

      if (check.status === "fail") {
        const fails = prev.fails + 1;
        const alerted = prev.alerted || fails >= ALERT_AFTER_FAILS;
        if (alerted && !prev.alerted) {
          alerts.push({
            kind: "down",
            repoId: app.repoId,
            repoName: app.repoName,
            check: check.kind,
            text: downText(app, check.kind, check.detail),
          });
        }
        next[key] = { fails, alerted, at: check.checkedAt };
        continue;
      }

      if (prev.alerted) {
        alerts.push({
          kind: "up",
          repoId: app.repoId,
          repoName: app.repoName,
          check: check.kind,
          text: upText(app, check.kind, check.detail),
        });
      }
      next[key] = { fails: 0, alerted: false, at: check.checkedAt };
    }
  }

  return { alerts, state: next };
}
