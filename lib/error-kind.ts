import { isRateLimit } from "./rate-limit";
import { isAuthExpired } from "./auth-expired";
// Aus network-errors, NICHT aus workspace: Diese Datei wird von der
// Oberflaeche importiert, und workspace zieht node-Module mit sich.
import { isTransientNetworkError } from "./network-errors";

// req-037: Was für ein Fehler war das? Bislang stand die Antwort nur als Prosa
// in `message`, und wer wissen wollte, ob sich Netzwerkfehler häufen, musste
// per Textsuche raten. Das hat bei der Fehlersuche wiederholt zu falschen
// Schlüssen geführt: Eine Korrelation ("seit dem Kernel-Wechsel") sah aus wie
// eine Ursache, weil die Daten fehlten, um sie zu widerlegen.
//
// Die Einordnung ist bewusst grob. Sie soll eine Frage beantworten — "woran
// liegt es, wenn es sich häuft?" —, nicht jeden Einzelfall benennen. Feinere
// Kategorien wären genauer und würden seltener passen; dann landete wieder
// alles in "Sonstiges".

export type ErrorKind =
  | "network"
  | "rate-limit"
  | "auth"
  | "test-red"
  | "timeout"
  | "resources"
  | "other";

/** Was in der Oberfläche steht. Die Schlüssel oben bleiben englisch (Daten). */
export const ERROR_KIND_LABELS: Record<ErrorKind, string> = {
  network: "Netzwerk",
  "rate-limit": "Rate-Limit",
  auth: "Anmeldung",
  "test-red": "Testsuite rot",
  timeout: "Zeitüberschreitung",
  resources: "Rechner am Limit",
  other: "Sonstiges",
};

/**
 * Abbrüche der Verbindung zum KI-Anbieter. `isTransientNetworkError` deckt die
 * git-Seite ab (bug-020) und kennt diese Wortlaute nicht — sie kommen aus der
 * Anthropic-API, nicht aus git.
 */
const API_NETWORK_PATTERNS = [
  /connection closed mid-response/i,
  /connection (?:reset|refused|aborted)/i,
  /socket hang up/i,
  /\bECONNRESET\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bEAI_AGAIN\b/,
  /network (?:error|timeout)/i,
  /fetch failed/i,
];

/** Der Wortlaut, mit dem der Claude-Lauf seine Zeitgrenze meldet. */
const TIMEOUT_PATTERN = /Timeout \(\d+ min\)/i;

/** Der Wortlaut des Test-Gates, wenn die Suite rot ist. */
const TEST_RED_PATTERN = /Test-Suite rot/i;

/**
 * Fehler, die BEIM Netzwerkzugriff auftreten, aber nichts mit dem Netz zu tun
 * haben: Der Rechner selbst kann nicht mehr. Sie stehen in derselben Meldung
 * wie ein echter Netzwerkfehler ("fetch failed: error: cannot fork()"), und
 * ohne diese Ausnahme zählten sie als Netzstörung — dann suchte man beim
 * Anschluss, während die Ursache im Container lag (bug-018, 14.061 Zombies).
 */
const LOCAL_RESOURCE_PATTERNS = [
  /cannot fork|Resource temporarily unavailable/i,
  /out of memory|Cannot allocate memory|\bENOMEM\b/i,
  /no space left on device|\bENOSPC\b/i,
  /too many open files|\bEMFILE\b/i,
];

/**
 * Die Art eines Fehlers, aus seiner Meldung abgeleitet.
 *
 * Die Reihenfolge entscheidet, wo sich Meldungen überschneiden, und ist nicht
 * beliebig:
 *
 *  - Anmeldung und Rate-Limit zuerst: Sie sind die eindeutigsten Wortlaute, und
 *    beide führen zu einer Pause statt zu einem Fehlschlag — sie mit etwas
 *    anderem zu verwechseln, hätte die spürbarsten Folgen.
 *  - Testsuite vor Netzwerk: Eine rote Suite zitiert die Testausgabe, und darin
 *    kann jedes Wort vorkommen, auch "connection refused" aus einem Testfall.
 *    Ohne diese Reihenfolge würde ein Testfehler als Netzwerkstörung gezählt.
 *  - Zeitüberschreitung zuletzt vor "Sonstiges": Ein Timeout, der von
 *    Wiederholversuchen der API herrührt, nennt oft beides. Dann ist die
 *    Netzwerkstörung die Ursache und die Zeitgrenze nur ihre Folge — deshalb
 *    steht Netzwerk davor.
 */
export function errorKindOf(message: string | null | undefined): ErrorKind {
  const text = message ?? "";
  if (!text.trim()) return "other";

  if (isAuthExpired(text)) return "auth";
  if (isRateLimit(text)) return "rate-limit";
  if (TEST_RED_PATTERN.test(text)) return "test-red";
  // Vor der Netzwerkerkennung: Diese Meldungen tragen deren Wortlaute mit sich,
  // meinen aber den eigenen Rechner.
  if (LOCAL_RESOURCE_PATTERNS.some((p) => p.test(text))) return "resources";
  if (isTransientNetworkError(text)) return "network";
  if (API_NETWORK_PATTERNS.some((p) => p.test(text))) return "network";
  if (TIMEOUT_PATTERN.test(text)) return "timeout";
  return "other";
}
