import { normalizeUrl } from "./repos";
import { redact } from "./redact";
import {
  NO_CHANGES_DETAIL,
  commitAndPush,
  copyRepoFile,
  discardChanges,
  ensureRepoDir,
  listReady,
  listTree,
  prepareRepo,
  readRepoFile,
  repoPathExists,
  writeRepoFile,
} from "./workspace";

// req-012: bring a target repo up to the appbaua standard and push the result
// to its `dev` branch — the "Auf appbaua umstellen" button of the repo list.
//
// The source is the appbaua repo itself, freshly fetched on every run, and it is
// READ at runtime: which skills and which delivery folders exist is whatever the
// source has that day, never a list baked into this file. Add a skill or a
// folder to appbaua and the next rollout carries it along.
//
// What lands in the target:
//   1. every file under .claude/skills/ — same-named files overwritten, skills
//      that exist only in the target left alone (nothing is ever deleted);
//   2. the delivery folder structure as EMPTY folders — missing ones created,
//      existing ones including their content untouched;
//   3. a CLAUDE.md, but only when the target has none yet.
//
// The instruction files in the delivery root (devops.md, stack.md, vision.md,
// idea-direction.md, deploy-setup.md) are neither copied nor overwritten: they
// differ per repo and are maintained there. Since only folders are created from
// `delivery/` and no files, that follows from the rollout rules above rather
// than from an exclusion list — a new instruction file in appbaua cannot start
// leaking into other repos.
//
// The whole rollout is built in the local working copy first and pushed in ONE
// commit at the end, so a step that fails leaves the target untouched: nothing
// is pushed and the caller gets a concrete error. Running it again leads to the
// same state (idempotent) — the second run finds nothing to commit.

/** Where a repo's Claude skills live. */
export const SKILLS_DIR = ".claude/skills";
/** The folder whose structure is rolled out (its files are NOT). */
export const DELIVERY_DIR = "delivery";
export const CLAUDE_MD = "CLAUDE.md";
/**
 * The starter CLAUDE.md, read from the source repo so it can be edited without
 * touching code. Deliberately NOT under `delivery/`: everything there is rolled
 * out as structure, and a template folder has no business in a target repo.
 */
export const CLAUDE_MD_TEMPLATE = ".claude/templates/CLAUDE.md";
/** Placeholder that lets git carry an otherwise empty folder. */
export const GITKEEP = ".gitkeep";
/** The only branch the rollout ever writes to (see delivery/devops.md). */
export const TARGET_BRANCH = "dev";
/** The repo the standard is taken from, overridable per deployment. */
export const DEFAULT_SOURCE_REPO = "github.com/kruianer/appbaua";

export const COMMIT_MESSAGE =
  "appbaua: Standard ausgerollt (Skills + delivery-Struktur)";

/**
 * Safety net for a source repo without a CLAUDE.md template. Kept short on
 * purpose — the real starter lives in CLAUDE_MD_TEMPLATE; this only makes sure a
 * target that has no CLAUDE.md still ends up with one.
 */
export const FALLBACK_CLAUDE_MD = `# <Projekt>

## DevOps

Deploy, Umgebungen und Promotion-Regeln stehen in
[delivery/devops.md](delivery/devops.md). Befolge sie exakt. Insbesondere:
NIEMALS autonom nach prod deployen.

## Tech Stack

Sprachen, Frameworks, Kommandos und Konventionen stehen in
[delivery/stack.md](delivery/stack.md). Befolge sie exakt.

## Areas

Geschäftsfunktions-Bereiche der App, zur Einordnung von Requirements.
Ein Requirement gehört in genau eine Area. Noch keine Area definiert.
`;

export type ClaudeMdOutcome = "angelegt" | "unverändert";

export type ConvertSummary = {
  /** Skills rolled out — the skill folders the source offers. */
  skills: number;
  /** delivery folders the target now has (all of the source's structure). */
  folders: number;
  /** How many of those the target was still missing before this run. */
  foldersCreated: number;
  claudeMd: ClaudeMdOutcome;
  branch: string;
  /** What the push did, in the user's words. */
  pushDetail: string;
};

export type ConvertResult =
  | { ok: true; summary: ConvertSummary; message: string }
  | { ok: false; error: string };

export type ConvertDeps = {
  prepareRepo: (url: string, token: string) => Promise<string>;
  listTree: (
    dir: string,
    rel: string,
  ) => Promise<{ dirs: string[]; files: string[] }>;
  listEntries: (dir: string, rel: string) => Promise<string[]>;
  pathExists: (dir: string, rel: string) => Promise<boolean>;
  ensureDir: (dir: string, rel: string) => Promise<void>;
  copyFile: (
    fromDir: string,
    fromRel: string,
    toDir: string,
    toRel: string,
  ) => Promise<void>;
  readFile: (dir: string, rel: string) => Promise<string | null>;
  writeFile: (dir: string, rel: string, content: string) => Promise<void>;
  commitAndPush: (
    dir: string,
    message: string,
    token: string,
  ) => Promise<{ pushed: boolean; detail: string }>;
  discardChanges: (dir: string) => Promise<void>;
  token: string | undefined;
  /** Normalized URL of the repo the standard is read from. */
  sourceUrl: string;
};

function defaultDeps(): ConvertDeps {
  return {
    prepareRepo,
    listTree,
    listEntries: listReady,
    pathExists: repoPathExists,
    ensureDir: ensureRepoDir,
    copyFile: copyRepoFile,
    readFile: readRepoFile,
    writeFile: writeRepoFile,
    commitAndPush,
    discardChanges,
    token: process.env.GITHUB_TOKEN,
    sourceUrl: normalizeUrl(
      process.env.APPBAUA_SOURCE_REPO || DEFAULT_SOURCE_REPO,
    ),
  };
}

/**
 * The skills a source repo offers: the top-level folders under `.claude/skills`.
 * A skill is one folder, so that is also the unit the summary counts — a skill
 * made of five files is one skill, not five.
 */
export function skillNames(dirs: string[]): string[] {
  const prefix = `${SKILLS_DIR}/`;
  return dirs
    .filter((d) => d.startsWith(prefix))
    .map((d) => d.slice(prefix.length))
    .filter((name) => name && !name.includes("/"))
    .sort();
}

/** The short result the button shows after a successful rollout. */
export function summaryMessage(s: ConvertSummary): string {
  const skills = `${s.skills} ${s.skills === 1 ? "Skill" : "Skills"} kopiert`;
  const created = s.foldersCreated > 0 ? ` (${s.foldersCreated} neu)` : "";
  return (
    `${skills} · ${s.folders} delivery-Ordner${created}` +
    ` · CLAUDE.md ${s.claudeMd} · Ziel-Branch: ${s.branch} — ${s.pushDetail}`
  );
}

/**
 * Bring `targetUrl` up to the appbaua standard and push it to the target's
 * `dev` branch. Never throws: every failure comes back as `{ ok: false }` with a
 * message the UI can show, scrubbed of credentials (bug-003).
 */
export async function applyAppbauaStandard(
  targetUrl: string,
  deps: Partial<ConvertDeps> = {},
): Promise<ConvertResult> {
  const d: ConvertDeps = { ...defaultDeps(), ...deps };
  const fail = (message: string): ConvertResult => ({
    ok: false,
    error: redact(message),
  });

  if (!d.token) {
    return fail(
      "Kein GitHub-Token konfiguriert — ohne Token kann nicht auf das Zielrepo gepusht werden.",
    );
  }
  const token = d.token;

  const target = normalizeUrl(targetUrl);
  if (!target) return fail("Kein Zielrepo angegeben.");
  if (target === d.sourceUrl) {
    // Source and target would share one working copy; besides, appbaua IS the
    // standard, so there is nothing to roll out onto it.
    return fail(
      `${target} ist die Quelle des appbaua-Standards und muss nicht umgestellt werden.`,
    );
  }

  // 1. The source, freshly fetched — this is what "der aktuelle Stand" means.
  let sourceDir: string;
  try {
    sourceDir = await d.prepareRepo(d.sourceUrl, token);
  } catch (err) {
    return fail(`appbaua-Quelle konnte nicht geholt werden: ${String(err)}`);
  }

  const skills = await d.listTree(sourceDir, SKILLS_DIR);
  const deliveryDirs = (await d.listTree(sourceDir, DELIVERY_DIR)).dirs;

  // 2. The target. A missing `dev` is branched off the default branch here and
  // pushed below, so the rollout also works on a repo that has no dev yet.
  let targetDir: string;
  try {
    targetDir = await d.prepareRepo(target, token);
  } catch (err) {
    return fail(`Zielrepo konnte nicht vorbereitet werden: ${String(err)}`);
  }

  // 3. Build the whole rollout locally. Anything that goes wrong from here on
  // is thrown away instead of pushed.
  let summary: Omit<ConvertSummary, "pushDetail">;
  try {
    summary = await rollOut(d, sourceDir, targetDir, skills, deliveryDirs);
  } catch (err) {
    await d.discardChanges(targetDir).catch(() => {});
    return fail(`Umstellung abgebrochen, nichts gepusht: ${String(err)}`);
  }

  // 4. One commit, one push. Until this line the target repo is untouched.
  const push = await d.commitAndPush(targetDir, COMMIT_MESSAGE, token);
  if (!push.pushed && push.detail !== NO_CHANGES_DETAIL) {
    await d.discardChanges(targetDir).catch(() => {});
    return fail(`Nichts gepusht — ${push.detail}`);
  }

  const full: ConvertSummary = {
    ...summary,
    pushDetail: push.pushed
      ? `auf ${TARGET_BRANCH} gepusht`
      : "keine Änderungen nötig, war bereits auf Stand",
  };
  return { ok: true, summary: full, message: summaryMessage(full) };
}

/**
 * Write skills, folder structure and (if absent) CLAUDE.md into the target
 * working copy. Throws on the first failure, which the caller turns into an
 * aborted rollout.
 */
async function rollOut(
  d: ConvertDeps,
  sourceDir: string,
  targetDir: string,
  skills: { dirs: string[]; files: string[] },
  deliveryDirs: string[],
): Promise<Omit<ConvertSummary, "pushDetail">> {
  // Skills: file by file, overwriting same-named ones. Files the target has and
  // the source does not — a skill of its own, an extra reference file — are not
  // touched, so nothing of the target's is ever lost.
  for (const rel of skills.files) {
    await d.copyFile(sourceDir, rel, targetDir, rel);
  }

  // delivery structure. Which folders were missing has to be settled BEFORE any
  // of them is created: creating delivery/bugs/ready also creates delivery/bugs,
  // so a check interleaved with the creating would undercount.
  const missing = new Set<string>();
  for (const rel of deliveryDirs) {
    if (!(await d.pathExists(targetDir, rel))) missing.add(rel);
  }
  // delivery/ itself is the parent of the structure, not part of it: it is
  // ensured so an empty source still leaves a delivery/ behind, but it is not
  // counted among "alle Ordner unter delivery/".
  await d.ensureDir(targetDir, DELIVERY_DIR);
  for (const rel of deliveryDirs) await d.ensureDir(targetDir, rel);

  // git cannot carry an empty folder, so each one that has nothing in it gets a
  // .gitkeep. Done as a second pass, after every folder exists: a parent like
  // delivery/requirements holds its subfolders by then and needs no placeholder,
  // and a folder that already has content (req-012 AC) keeps it and stays as is.
  for (const rel of [DELIVERY_DIR, ...deliveryDirs]) {
    const entries = await d.listEntries(targetDir, rel);
    if (entries.length === 0) await d.writeFile(targetDir, `${rel}/${GITKEEP}`, "");
  }

  // CLAUDE.md only when the target has none — an existing one is the repo's own
  // and is never overwritten.
  let claudeMd: ClaudeMdOutcome = "unverändert";
  if (!(await d.pathExists(targetDir, CLAUDE_MD))) {
    const template =
      (await d.readFile(sourceDir, CLAUDE_MD_TEMPLATE)) ?? FALLBACK_CLAUDE_MD;
    await d.writeFile(targetDir, CLAUDE_MD, template);
    claudeMd = "angelegt";
  }

  return {
    skills: skillNames(skills.dirs).length,
    folders: deliveryDirs.length,
    foldersCreated: missing.size,
    claudeMd,
    branch: TARGET_BRANCH,
  };
}

/**
 * Rollouts share work directories — one per repo, plus the source checkout every
 * one of them fetches and resets. Two at the same time would read a source that
 * the other is resetting under them, so they are run one after another.
 */
let queue: Promise<unknown> = Promise.resolve();

export function queueAppbauaStandard(
  targetUrl: string,
  deps: Partial<ConvertDeps> = {},
): Promise<ConvertResult> {
  const run = queue.then(() => applyAppbauaStandard(targetUrl, deps));
  // The chain must survive a rejected run, otherwise every later rollout
  // inherits that rejection.
  queue = run.catch(() => undefined);
  return run;
}
