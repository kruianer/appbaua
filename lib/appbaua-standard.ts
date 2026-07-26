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
  prepareRepoOnDevOrDefault,
  readRepoFile,
  repoPathExists,
  writeRepoFile,
} from "./workspace";

// req-012: bring a target repo up to the appbaua standard and push the result
// to it — the "Auf appbaua umstellen" button of the repo list.
//
// req-013 decides WHERE it lands: a target that already has a `dev` branch gets
// the rollout there as before, a target without one gets it on its own default
// branch. No `dev` is created, so a fresh repo does not grow a branch its owner
// never asked for. The result message names the branch that was actually used.
//
// The source is the appbaua repo itself, freshly fetched on every run, and it is
// READ at runtime: which skills and which delivery/site folders exist is whatever
// the source has that day, never a list baked into this file. Add a skill or a
// folder to appbaua and the next rollout carries it along.
//
// What lands in the target:
//   1. every file under .claude/skills/ — same-named files overwritten, skills
//      that exist only in the target left alone (nothing is ever deleted);
//   2. the delivery folder structure as EMPTY folders — missing ones created,
//      existing ones including their content untouched;
//   3. the site folder structure (req-018), by exactly the same rules — a
//      converted repo has the doc task, so it needs the place that task writes
//      to (site/user-docs/ and whatever else appbaua puts under site/). As long
//      as appbaua has no site/ of its own, nothing of it is rolled out;
//   4. a CLAUDE.md, but only when the target has none yet.
//
// The instruction files in the delivery root (devops.md, stack.md, vision.md,
// idea-direction.md, deploy-setup.md) are neither copied nor overwritten: they
// differ per repo and are maintained there. Since only folders are created from
// `delivery/` and no files, that follows from the rollout rules above rather
// than from an exclusion list — a new instruction file in appbaua cannot start
// leaking into other repos. The same holds for `site/`: appbaua's own doc pages
// stay in appbaua, only their folders travel.
//
// The whole rollout is built in the local working copy first and pushed in ONE
// commit at the end, so a step that fails leaves the target untouched: nothing
// is pushed and the caller gets a concrete error. Running it again leads to the
// same state (idempotent) — the second run finds nothing to commit.

/** Where a repo's Claude skills live. */
export const SKILLS_DIR = ".claude/skills";
/** The folder whose structure is rolled out (its files are NOT). */
export const DELIVERY_DIR = "delivery";
/**
 * The web output folder (req-018) — `site/user-docs/` today, plus whatever
 * appbaua adds later. Rolled out as structure only, exactly like DELIVERY_DIR:
 * a repo that gets the doc task needs the place that task writes to.
 */
export const SITE_DIR = "site";
export const CLAUDE_MD = "CLAUDE.md";
/**
 * The starter CLAUDE.md, read from the source repo so it can be edited without
 * touching code. Deliberately NOT under `delivery/`: everything there is rolled
 * out as structure, and a template folder has no business in a target repo.
 */
export const CLAUDE_MD_TEMPLATE = ".claude/templates/CLAUDE.md";
/** Placeholder that lets git carry an otherwise empty folder. */
export const GITKEEP = ".gitkeep";
/** The repo the standard is taken from, overridable per deployment. */
export const DEFAULT_SOURCE_REPO = "github.com/kruianer/appbaua";

export const COMMIT_MESSAGE =
  "appbaua: Standard ausgerollt (Skills + delivery- und site-Struktur)";

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
  /** site folders the target now has — same rules as `folders` (req-018). */
  siteFolders: number;
  /** How many of those the target was still missing before this run. */
  siteFoldersCreated: number;
  claudeMd: ClaudeMdOutcome;
  /** The branch the rollout actually used — the target's `dev` or its default. */
  branch: string;
  /** What the push did, in the user's words. */
  pushDetail: string;
};

export type ConvertResult =
  | { ok: true; summary: ConvertSummary; message: string }
  | { ok: false; error: string };

export type ConvertDeps = {
  /** Fetch the SOURCE repo (appbaua) and hand back its working copy. */
  prepareRepo: (url: string, token: string) => Promise<string>;
  /**
   * Fetch the TARGET repo on the branch the rollout writes to (req-013): its
   * `dev` if it has one, otherwise its default branch. Never creates a branch.
   */
  prepareTarget: (
    url: string,
    token: string,
  ) => Promise<{ dir: string; branch: string }>;
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
    opts?: { branch?: string },
  ) => Promise<{ pushed: boolean; detail: string }>;
  discardChanges: (dir: string) => Promise<void>;
  token: string | undefined;
  /** Normalized URL of the repo the standard is read from. */
  sourceUrl: string;
};

function defaultDeps(): ConvertDeps {
  return {
    prepareRepo,
    prepareTarget: prepareRepoOnDevOrDefault,
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
  // Both structures are reported the same way, because they are rolled out the
  // same way (req-018) — "(n neu)" only when this run actually created folders.
  const folders = (total: number, created: number, label: string) =>
    `${total} ${label}-Ordner${created > 0 ? ` (${created} neu)` : ""}`;
  const parts = [skills, folders(s.folders, s.foldersCreated, "delivery")];
  // As long as the source has no site/, there is nothing to report about it —
  // better than a "0 site-Ordner" nobody can act on.
  if (s.siteFolders > 0) {
    parts.push(folders(s.siteFolders, s.siteFoldersCreated, "site"));
  }
  parts.push(
    `CLAUDE.md ${s.claudeMd}`,
    `Ziel-Branch: ${s.branch} — ${s.pushDetail}`,
  );
  return parts.join(" · ");
}

/**
 * Bring `targetUrl` up to the appbaua standard and push it to the target's own
 * `dev` branch, or — when it has none — to its default branch (req-013). Never
 * throws: every failure comes back as `{ ok: false }` with a message the UI can
 * show, scrubbed of credentials (bug-003).
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
  // Both structures are read the same way and at runtime (req-018): a site/www
  // added to appbaua tomorrow rolls out the day after, without a line of code
  // changing here.
  const delivery = await readStructure(d, sourceDir, DELIVERY_DIR);
  const site = await readStructure(d, sourceDir, SITE_DIR);

  // 2. The target, on the branch this rollout belongs on: its `dev` if it has
  // one, else its default branch (req-013). Nothing is created here — a repo
  // without `dev` keeps not having one.
  let targetDir: string;
  let branch: string;
  try {
    const prepared = await d.prepareTarget(target, token);
    targetDir = prepared.dir;
    branch = prepared.branch;
  } catch (err) {
    return fail(`Zielrepo konnte nicht vorbereitet werden: ${String(err)}`);
  }

  // 3. Build the whole rollout locally. Anything that goes wrong from here on
  // is thrown away instead of pushed.
  let summary: Omit<ConvertSummary, "branch" | "pushDetail">;
  try {
    summary = await rollOut(d, sourceDir, targetDir, skills, delivery, site);
  } catch (err) {
    await d.discardChanges(targetDir).catch(() => {});
    return fail(`Umstellung abgebrochen, nichts gepusht: ${String(err)}`);
  }

  // 4. One commit, one push. Until this line the target repo is untouched.
  const push = await d.commitAndPush(targetDir, COMMIT_MESSAGE, token, {
    branch,
  });
  if (!push.pushed && push.detail !== NO_CHANGES_DETAIL) {
    await d.discardChanges(targetDir).catch(() => {});
    return fail(`Nichts gepusht — ${push.detail}`);
  }

  const full: ConvertSummary = {
    ...summary,
    branch,
    pushDetail: push.pushed
      ? `auf ${branch} gepusht`
      : "keine Änderungen nötig, war bereits auf Stand",
  };
  return { ok: true, summary: full, message: summaryMessage(full) };
}

/**
 * Write skills, both folder structures and (if absent) CLAUDE.md into the target
 * working copy. Throws on the first failure, which the caller turns into an
 * aborted rollout.
 */
async function rollOut(
  d: ConvertDeps,
  sourceDir: string,
  targetDir: string,
  skills: { dirs: string[]; files: string[] },
  delivery: Structure,
  site: Structure,
): Promise<Omit<ConvertSummary, "branch" | "pushDetail">> {
  // Skills: file by file, overwriting same-named ones. Files the target has and
  // the source does not — a skill of its own, an extra reference file — are not
  // touched, so nothing of the target's is ever lost. A skill added to appbaua
  // (setup-doc-site, say) needs no rule of its own: it is simply among the files.
  for (const rel of skills.files) {
    await d.copyFile(sourceDir, rel, targetDir, rel);
  }

  const deliveryOut = await rollOutStructure(d, targetDir, delivery);
  const siteOut = await rollOutStructure(d, targetDir, site);

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
    folders: deliveryOut.folders,
    foldersCreated: deliveryOut.created,
    siteFolders: siteOut.folders,
    siteFoldersCreated: siteOut.created,
    claudeMd,
  };
}

/** One rolled-out folder structure of the source: `delivery/` or `site/`. */
type Structure = {
  root: string;
  /** Every folder below the root, as repo-relative paths. */
  dirs: string[];
  /** Does the source have the root at all? A folder it lacks is not standard. */
  present: boolean;
};

/**
 * The structure the source offers below `root`, read at runtime (req-018).
 * `delivery/` and `site/` are read the same way, so neither can drift away from
 * the other — and a root the source does not have yields nothing at all rather
 * than a lone empty folder in every target repo.
 */
async function readStructure(
  d: ConvertDeps,
  sourceDir: string,
  root: string,
): Promise<Structure> {
  return {
    root,
    dirs: (await d.listTree(sourceDir, root)).dirs,
    present: await d.pathExists(sourceDir, root),
  };
}

/**
 * Roll ONE folder structure out into the target: every folder the source has
 * below the root is created where it is missing, and every folder that ends up
 * empty gets a `.gitkeep`. Folders the target already has keep their content —
 * nothing here ever deletes or empties anything.
 *
 * `delivery/` and `site/` go through this same function on purpose (req-018):
 * the two really do follow identical rules, and one of them cannot drift away
 * from the other by accident. Returns how many folders the structure has and how
 * many of them this run had to create.
 */
async function rollOutStructure(
  d: ConvertDeps,
  targetDir: string,
  structure: Structure,
): Promise<{ folders: number; created: number }> {
  // A root the source does not have is not part of the standard, so the target
  // does not grow an empty one either. `site/` starts travelling with the first
  // web output appbaua itself puts there.
  if (!structure.present) return { folders: 0, created: 0 };
  const { root, dirs } = structure;

  // Which folders were missing has to be settled BEFORE any of them is created:
  // creating delivery/bugs/ready also creates delivery/bugs, so a check
  // interleaved with the creating would undercount.
  const missing = new Set<string>();
  for (const rel of dirs) {
    if (!(await d.pathExists(targetDir, rel))) missing.add(rel);
  }
  // The root itself is the parent of the structure, not part of it: it is
  // ensured so a source root without subfolders still leaves its folder behind,
  // but it is not counted among "alle Ordner unter delivery/".
  await d.ensureDir(targetDir, root);
  for (const rel of dirs) await d.ensureDir(targetDir, rel);

  // git cannot carry an empty folder, so each one that has nothing in it gets a
  // .gitkeep. Done as a second pass, after every folder exists: a parent like
  // delivery/requirements holds its subfolders by then and needs no placeholder,
  // and a folder that already has content (req-012/req-018 AC) keeps it and
  // stays as is.
  for (const rel of [root, ...dirs]) {
    const entries = await d.listEntries(targetDir, rel);
    if (entries.length === 0) await d.writeFile(targetDir, `${rel}/${GITKEEP}`, "");
  }

  return { folders: dirs.length, created: missing.size };
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
