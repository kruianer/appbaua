// Die Naht zwischen Logs, KI-Anbieter der App, Speicher und Verlauf (req-035).
//
// Drei Wege stoßen eine Analyse an — regelmäßig, bei einem gemeldeten Ausfall,
// auf Knopfdruck — und alle drei laufen durch analyzeRepoLogs. Der Unterschied
// steht im `trigger` und in der Frage, ob ein Schalter der Einstellungen den
// Weg überhaupt freigibt (der Knopf braucht keinen Schalter: er IST die
// Entscheidung des Nutzers).
//
// Nichts hiervon darf die Überwachung anhalten: antwortet der Anbieter nicht,
// steht der Fehlschlag im Verlauf und auf der Karte, und die Prüfungen laufen
// unverändert weiter.

import { type DockerClient, createDockerClient } from "./docker";
import {
  type DockerContainer,
  type HealthSpec,
  matchContainers,
  parseHealthMd,
} from "./health";
import { getHealthStore } from "./health-store";
import { fetchHealthMd } from "./health-md-source";
import { listRepos } from "./repo-service";
import type { Repo } from "./repos";
import { redact } from "./redact";
import { RECURRING_MD } from "./run-log";
import { getRunLogStore } from "./run-log-store";
import {
  type AnalysisTrigger,
  type ContainerLog,
  type LogAnalysis,
  ANALYSIS_TIMEOUT_MS,
  DEFAULT_ANALYSIS_MODELS,
  MAX_LOG_CONTAINERS,
  MAX_LOG_LINES,
  NO_FINDING_TEXT,
  analysisIsDue,
  buildAnalysisPrompt,
  buildAnalysisRequest,
  buildLogBundle,
  extractReplyText,
  parseAnalysisReply,
} from "./log-analysis";

/** Was der Verlauf als "Task-Typ" zu einer Log-Analyse zeigt. */
export const ANALYSIS_LOG_LABEL = "Log-Analyse";

export type AnalysisDeps = {
  docker: DockerClient;
  fetchImpl: typeof fetch;
  /** Liest `delivery/health.md` aus dem Zielrepo, oder null wenn es keine gibt. */
  readHealthMd: (repo: Repo) => Promise<string | null>;
  now: () => Date;
};

function defaultDeps(): AnalysisDeps {
  return {
    docker: createDockerClient(),
    fetchImpl: fetch,
    readHealthMd: (repo) => fetchHealthMd(repo),
    now: () => new Date(),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Die zuletzt gespeicherten Analysen, je Repo eine. */
export async function readAnalyses() {
  return getHealthStore().getAnalyses();
}

/**
 * Eine Analyse ablegen und im Verlauf vermerken. Der Verlauf ist best effort:
 * scheitert er, bleibt das Ergebnis trotzdem auf der Karte.
 */
async function record(analysis: LogAnalysis, repoName: string): Promise<LogAnalysis> {
  const store = getHealthStore();
  const before = await store.getAnalyses();
  await store.setAnalyses({ ...before, [analysis.repoId]: analysis });
  try {
    await getRunLogStore().append({
      startedAt: analysis.at,
      endedAt: analysis.at,
      repo: repoName,
      taskType: ANALYSIS_LOG_LABEL,
      status: analysis.status === "error" ? "error" : "success",
      message: redact(analysis.summary),
      md: RECURRING_MD,
    });
  } catch {
    /* der Verlauf ist nicht der Zweck dieses Laufs */
  }
  return analysis;
}

/** Die Container, deren Logs gelesen werden — höchstens MAX_LOG_CONTAINERS. */
function logTargets(
  spec: HealthSpec,
  repo: Repo,
  containers: DockerContainer[],
): DockerContainer[] {
  return matchContainers(spec, repo.name, containers).slice(0, MAX_LOG_CONTAINERS);
}

/** Den Schlüssel der App aus der Umgebung IHRER Container holen (wie req-032). */
async function readKey(
  docker: DockerClient,
  containers: DockerContainer[],
  keyEnv: string,
): Promise<string> {
  for (const c of containers) {
    try {
      const value = await docker.env(c.id, keyEnv);
      if (value) return value;
    } catch {
      /* nächster Container */
    }
  }
  return "";
}

/**
 * Eine Analyse für genau ein Repo. Gibt null zurück, wenn es das Repo nicht
 * gibt oder es nicht überwacht wird — dann ist gar nichts zu tun.
 *
 * Jeder andere Ausgang ist ein Ergebnis: ein Befund, ein ausdrückliches "keine
 * Auffälligkeiten" oder ein Fehlschlag. Alle drei landen auf der Karte und im
 * Verlauf (req-035).
 */
export async function analyzeRepoLogs(
  repoId: string,
  trigger: AnalysisTrigger,
  deps?: Partial<AnalysisDeps>,
  opts?: { failure?: string | null },
): Promise<LogAnalysis | null> {
  const repos = await listRepos();
  const repo = repos.find((r) => r.id === repoId);
  if (!repo || !repo.monitored) return null;

  const full: AnalysisDeps = { ...defaultDeps(), ...deps };
  const at = full.now().toISOString();
  const fail = (summary: string) =>
    record({ repoId, at, trigger, status: "error" as const, summary }, repo.name);

  const spec = parseHealthMd(await full.readHealthMd(repo).catch(() => null));
  if (!spec.ai) {
    return fail('kein Abschnitt "## KI-Anbieter" in der health.md — keine Analyse möglich');
  }

  let containers: DockerContainer[];
  try {
    containers = logTargets(spec, repo, await full.docker.list());
  } catch (err) {
    return fail(`Docker nicht erreichbar: ${messageOf(err)}`);
  }
  if (containers.length === 0) {
    return fail(`kein Container der App ${repo.name} gefunden`);
  }

  const key = await readKey(full.docker, containers, spec.ai.keyEnv);
  if (!key) {
    return fail(`${spec.ai.keyEnv} in keinem Container der App gesetzt`);
  }

  const logs: ContainerLog[] = [];
  for (const c of containers) {
    try {
      const text = await full.docker.logs(c.id, MAX_LOG_LINES);
      if (text.trim()) logs.push({ name: c.name, text });
    } catch {
      /* ein unlesbares Log hält die übrigen nicht auf */
    }
  }
  if (logs.length === 0) return fail("kein Log lesbar");

  const model = spec.ai.model || DEFAULT_ANALYSIS_MODELS[spec.ai.provider];
  if (!model) return fail(`Anbieter ${spec.ai.provider} nicht unterstützt`);

  const prompt = buildAnalysisPrompt(repo.name, buildLogBundle(logs), opts);
  const request = buildAnalysisRequest(spec.ai.provider, key, model, prompt);
  if (!request) return fail(`Anbieter ${spec.ai.provider} nicht unterstützt`);

  let payload: unknown;
  try {
    const res = await full.fetchImpl(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });
    if (!res.ok) {
      return fail(`${spec.ai.provider} antwortet mit ${res.status}`);
    }
    payload = await res.json();
  } catch (err) {
    // Der Schlüssel der App steckt im Aufruf; eine Fehlermeldung, die ihn
    // zitiert, darf so nicht im Verlauf landen.
    return fail(redact(`${spec.ai.provider}: ${messageOf(err)}`, [key]));
  }

  const parsed = parseAnalysisReply(extractReplyText(spec.ai.provider, payload));
  if (!parsed) return fail(`${spec.ai.provider}: Antwort nicht verwertbar`);

  return record(
    {
      repoId,
      at,
      trigger,
      status: parsed.finding ? "finding" : "clear",
      // Ohne Befund steht ausdrücklich das da — nicht die Prosa des Modells,
      // die sonst wie ein Befund aussähe (req-035).
      summary: parsed.finding ? parsed.summary : NO_FINDING_TEXT,
    },
    repo.name,
  );
}

/**
 * Die Analyse zu einem gemeldeten Ausfall (req-035). Gibt den Befundtext
 * zurück, damit er MIT der Telegram-Nachricht hinausgeht — ohne Befund (oder
 * abgeschaltet) null, dann bleibt die Nachricht wie sie war.
 */
export async function analyzeOnFailure(
  repoId: string,
  failure: string,
  deps?: Partial<AnalysisDeps>,
): Promise<string | null> {
  const settings = await getHealthStore().getSettings();
  if (!settings.logAnalysisOnFailure) return null;
  const analysis = await analyzeRepoLogs(repoId, "failure", deps, { failure });
  return analysis && analysis.status === "finding" ? analysis.summary : null;
}

/** Läuft gerade eine Runde? Zwei parallele wären doppelte Kosten. */
let roundRunning = false;

/**
 * Die regelmäßige Analyse über alle überwachten Repos, aber nur für die, die
 * fällig sind. Gibt zurück, wie viele gelaufen sind.
 *
 * Nacheinander, nicht nebenläufig: jeder Lauf kostet Geld, und ein Stau bei
 * einem Anbieter soll nicht alle übrigen gleichzeitig blockieren.
 */
export async function runDueAnalyses(deps?: Partial<AnalysisDeps>): Promise<number> {
  if (roundRunning) return 0;
  roundRunning = true;
  try {
    const store = getHealthStore();
    const [settings, previous, repos] = await Promise.all([
      store.getSettings(),
      store.getAnalyses(),
      listRepos(),
    ]);
    if (!settings.logAnalysis) return 0;
    const now = (deps?.now ?? (() => new Date()))();

    let ran = 0;
    for (const repo of repos.filter((r) => r.monitored)) {
      if (!analysisIsDue(previous[repo.id], settings.logAnalysisIntervalHours, now)) {
        continue;
      }
      await analyzeRepoLogs(repo.id, "scheduled", deps).catch(() => null);
      ran += 1;
    }
    return ran;
  } finally {
    roundRunning = false;
  }
}
