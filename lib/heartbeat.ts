// Der Herzschlag nach draußen (req-034). Reine Logik und genau ein fetch —
// kein Speicher, kein Verlauf; das hängt in heartbeat-service.ts daran.
//
// Warum es das gibt: die Zustandsübersicht (req-032) und die Telegram-Meldungen
// (req-033) laufen auf DEMSELBEN Rechner wie die überwachten Apps. Fällt dieser
// Rechner aus — Strom, Internet, appbaua tot —, ist der Wächter mit weg und
// niemand erfährt davon. appbaua meldet sich deshalb regelmäßig bei einem
// Wächter beim Webhoster (watchdog/), der nichts anderes tut, als das Ausbleiben
// dieser Meldung zu bemerken.
//
// Die Meldung enthält NUR den Zeitpunkt und die Kennung — keine Daten über die
// überwachten Apps. Der Wächter soll nichts wissen, was er nicht braucht.

/** Abstand zweier Herzschläge, wenn nichts anderes gesetzt ist. */
export const DEFAULT_HEARTBEAT_MINUTES = 5;

export const MIN_HEARTBEAT_MINUTES = 1;

/**
 * Obergrenze des Abstands. Der Wächter schlägt nach 15 Minuten ohne Herzschlag
 * Alarm (watchdog/private/watchdog.php); ein größerer Abstand hier würde also
 * bei völlig gesundem Rechner Fehlalarme auslösen. 10 Minuten lassen Raum für
 * einen ausgefallenen Versuch, ohne die Grenze zu reißen.
 */
export const MAX_HEARTBEAT_MINUTES = 10;

/** Ein einzelner Versand darf nicht ewig hängen — der Takt soll weiterlaufen. */
export const HEARTBEAT_TIMEOUT_MS = 15_000;

/** Der Header, in dem die Kennung steckt. */
export const HEARTBEAT_TOKEN_HEADER = "X-Watchdog-Token";

export type HeartbeatConfig = {
  /** Volle Adresse von heartbeat.php beim Hoster. */
  url: string;
  /** Die gemeinsame Kennung. Steht in der env-Datei, nie im Repo. */
  token: string;
  intervalMinutes: number;
};

function clampMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HEARTBEAT_MINUTES;
  return Math.min(MAX_HEARTBEAT_MINUTES, Math.max(MIN_HEARTBEAT_MINUTES, Math.round(n)));
}

/**
 * Die Zugangsdaten des Wächters, oder null wenn sie fehlen. Fehlen sie, ist der
 * Wächter schlicht nicht eingerichtet: appbaua schlägt dann keinen Herzschlag,
 * läuft aber unverändert weiter.
 */
export function readHeartbeatConfig(
  env: Record<string, string | undefined> = process.env,
): HeartbeatConfig | null {
  const url = (env.WATCHDOG_URL ?? "").trim();
  const token = (env.WATCHDOG_TOKEN ?? "").trim();
  if (!url || !token) return null;
  return { url, token, intervalMinutes: clampMinutes(env.WATCHDOG_INTERVAL_MINUTES) };
}

export function intervalMs(config: HeartbeatConfig): number {
  return config.intervalMinutes * 60 * 1000;
}

/**
 * Was appbaua über den letzten Herzschlag weiß. `acceptedAt` ist der Zeitpunkt,
 * zu dem der WÄCHTER ihn angenommen hat — nicht der, zu dem appbaua ihn
 * losschickte. Nur der beweist, dass die Strecke bis zum Hoster steht.
 *
 * `error` ist die Begründung des letzten gescheiterten Versuchs und steht so
 * lange, bis wieder einer ankommt.
 */
export type HeartbeatStatus = {
  acceptedAt: string | null;
  error: string | null;
};

export const EMPTY_HEARTBEAT_STATUS: HeartbeatStatus = {
  acceptedAt: null,
  error: null,
};

/** Was der Speicher hergibt, in eine brauchbare Form. */
export function normalizeHeartbeatStatus(raw: unknown): HeartbeatStatus {
  const input = (raw ?? {}) as Partial<HeartbeatStatus>;
  return {
    acceptedAt: typeof input.acceptedAt === "string" ? input.acceptedAt : null,
    error: typeof input.error === "string" && input.error !== "" ? input.error : null,
  };
}

/**
 * Der vom Wächter bestätigte Zeitpunkt aus seiner Antwort. Kommt er nicht damit
 * heraus (alter Wächter, seltsamer Proxy), gilt die eigene Uhr: angenommen
 * wurde der Schlag ja trotzdem, nur der genaue Stempel fehlt.
 */
export function acceptedAtFrom(body: unknown, fallback: Date): string {
  const at = (body as { at?: unknown } | null)?.at;
  if (typeof at === "string") {
    const parsed = new Date(at);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

/**
 * Einen Herzschlag senden. Gibt den vom Wächter bestätigten Zeitpunkt zurück
 * und wirft, wenn er nicht erreichbar war oder die Kennung ablehnte — was der
 * Aufrufer daraus macht (Verlauf), entscheidet heartbeat-service.ts.
 */
export async function sendHeartbeat(
  config: HeartbeatConfig,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [HEARTBEAT_TOKEN_HEADER]: config.token,
    },
    // Nur der Zeitpunkt. Über die überwachten Apps steht hier bewusst nichts.
    body: JSON.stringify({ at: now.toISOString() }),
    signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wächter antwortet mit ${res.status}`);
  const body = await res.json().catch(() => null);
  return acceptedAtFrom(body, now);
}
