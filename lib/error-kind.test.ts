import { describe, it, expect } from "vitest";
import { ERROR_KIND_LABELS, errorKindOf, type ErrorKind } from "./error-kind";

// req-037: Die Einordnung ist nur so viel wert wie ihre Treffsicherheit bei
// den Meldungen, die tatsächlich auftreten. Deshalb steht hier durchgehend
// echter Wortlaut aus dem prod-Verlauf, kein erfundener.

/** Meldungen, wie der Worker sie zwischen Juli und September geschrieben hat. */
const ECHT: Record<string, { text: string; kind: ErrorKind }> = {
  "GitHub nicht erreichbar (07.09.)": {
    text:
      "Repo vorbereiten fehlgeschlagen (LivingGardenKeeper): Error: default " +
      "branch unknown: fatal: unable to access " +
      "'https://github.com/kruianer/livinggardenkeeper.git/': Failed to " +
      "connect to github.com:443 after 134549 ms: Could not connect to server",
    kind: "network",
  },
  "DNS weg (06.08.)": {
    text:
      "Repo vorbereiten fehlgeschlagen (Wegfara): Error: fetch failed: fatal: " +
      "unable to access 'https://github.com/kruianer/wegfara.git/': Could not " +
      "resolve host: github.com (DNS server returned general failure)",
    kind: "network",
  },
  "Verbindung zur API riss ab (07.09.)": {
    text:
      "Claude-Lauf: Claude-Lauf fehlgeschlagen: API Error: Connection closed " +
      "mid-response. The response above may be incomplete. — " +
      "bug-021-fehlgeschlagenes-speichern-wird-nicht-gemeldet.md nach failed/ " +
      "verschoben (auf dev gepusht)",
    kind: "network",
  },
  "Session-Limit (26.07.)": {
    text:
      "Claude-Lauf: Claude-Lauf fehlgeschlagen: You've hit your session limit " +
      "· resets 10:50pm (UTC) — req-001-wechselplatte.md nach failed/ verschoben",
    kind: "rate-limit",
  },
  "Anmeldung abgelaufen (22.08.)": {
    text:
      "Claude-Lauf: Claude-Lauf fehlgeschlagen: Failed to authenticate: OAuth " +
      "session expired and could not be refreshed — bug-039-ds07.md nach " +
      "failed/ verschoben",
    kind: "auth",
  },
  "Testsuite rot (27.07.)": {
    text:
      "Test-Suite rot: npm test: ❯ app/login/page.test.tsx:44:5\n" +
      "Error: act(...) is not supported in production builds of React.",
    kind: "test-red",
  },
  "Zeitgrenze gerissen (07.09.)": {
    text:
      'Claude-Lauf: Claude-Lauf: Timeout (60 min) — zuletzt: 5d-49f3-8c78-' +
      'efaef7d1857b","uuid":"699a6688-1a42-46dd-b325-ff27866111af"}',
    kind: "timeout",
  },
  "Zombie-Prozesse (01.08.)": {
    // Steht in derselben Meldung wie ein Netzwerkfehler ("fetch failed"),
    // meint aber den eigenen Rechner: 14.061 Zombies, der Container konnte
    // nicht mehr forken (bug-018). Als "Netzwerk" gezählt hätte man beim
    // Anschluss gesucht statt im Container.
    text:
      "Repo vorbereiten fehlgeschlagen (Wegfara): Error: fetch failed: error: " +
      "cannot fork() for git-remote-https: Resource temporarily unavailable",
    kind: "resources",
  },
};

describe("errorKindOf — echte Meldungen aus dem Verlauf (req-037)", () => {
  for (const [name, { text, kind }] of Object.entries(ECHT)) {
    it(`ordnet ein: ${name} -> ${kind}`, () => {
      expect(errorKindOf(text)).toBe(kind);
    });
  }
});

describe("errorKindOf — Reihenfolge bei Ueberschneidungen (req-037)", () => {
  it("AC: eine rote Suite bleibt rot, auch wenn die Testausgabe von Verbindungen spricht", () => {
    // Ein Testfall, der Netzwerkverhalten prüft, zitiert genau die Wortlaute,
    // an denen die Netzwerkerkennung hängt. Ohne die richtige Reihenfolge
    // zählte jeder solche Testfehler als Netzwerkstörung — und die Statistik
    // zeigte ein Problem, das es nicht gibt.
    const text =
      "Test-Suite rot: npm test: FAIL lib/api.test.ts\n" +
      '  expected "connection refused" but got "ECONNRESET"';
    expect(errorKindOf(text)).toBe("test-red");
  });

  it("AC: ein Timeout durch Verbindungs-Wiederholungen zaehlt als Netzwerk", () => {
    // Der Fall vom 08.09.: Die Stunde ging für api_retry drauf, nicht für
    // Arbeit. Als "Zeitüberschreitung" gezählt sähe es aus, als sei das
    // Requirement zu groß geschnitten — die Ursache lag aber in der Leitung.
    const text =
      'Claude-Lauf: Timeout (60 min) — zuletzt: {"type":"system",' +
      '"subtype":"api_retry","attempt":4,"max_retries":10,' +
      '"error":"fetch failed","session_id":"628b9105"}';
    expect(errorKindOf(text)).toBe("network");
  });

  it("eine abgelaufene Anmeldung geht einem Rate-Limit vor", () => {
    // Beide führen zu einer Pause, aber zu sehr unterschiedlich langer. Eine
    // Verwechslung hiesse: Der Worker wartet eine Stunde auf etwas, das nur
    // ein Mensch beheben kann.
    const text =
      "Failed to authenticate: OAuth session expired — session limit erreicht";
    expect(errorKindOf(text)).toBe("auth");
  });
});

describe("errorKindOf — Randfaelle (req-037)", () => {
  it("eine leere Meldung ist 'Sonstiges', kein Absturz", () => {
    expect(errorKindOf("")).toBe("other");
    expect(errorKindOf("   ")).toBe("other");
    expect(errorKindOf(null)).toBe("other");
    expect(errorKindOf(undefined)).toBe("other");
  });

  it("was zu nichts passt, landet in 'Sonstiges' statt geraten zu werden", () => {
    expect(errorKindOf("Irgendwas ist schiefgegangen")).toBe("other");
  });

  it("jede Art hat eine deutsche Beschriftung", () => {
    const kinds: ErrorKind[] = [
      "network",
      "rate-limit",
      "auth",
      "test-red",
      "timeout",
      "resources",
      "other",
    ];
    for (const k of kinds) {
      expect(ERROR_KIND_LABELS[k]).toBeTruthy();
    }
  });
});
