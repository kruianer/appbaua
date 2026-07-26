import { promises as fs } from "node:fs";
import path from "node:path";
import { USER_DOCS_DIR } from "./doc-site";

// Screenshots for the user documentation (req-017). The Doku task (req-016)
// wrote text only; this module gives it pictures: before Claude writes a single
// line, the worker itself drives a headless browser (Playwright) over the app's
// RUNNING dev environment and puts the images into the docs folder — so the
// pages can point at files that are really there, and the images travel with the
// docs on the same push.
//
// Why the worker takes them and not Claude: whether a screenshot exists has to
// be a FACT the Verlauf can report ("ohne Bild: /verlauf"), not a sentence
// somebody wrote — the same reason the Ideen task reads its folder instead of
// Claude's answer (req-011).
//
// Nothing in here may ever fail the Doku run (req-017): no browser, an
// unreachable dev environment, a page that wants a login or is simply broken —
// each of those costs its own picture and nothing else. Every failure comes back
// as an entry in `missing`, never as a thrown error.

/**
 * The repo file that names the app's dev environment. Its `## Environments`
 * table is a machine contract of the setup-devops skill (headings, branch names
 * and paths stay unchanged in every language), which is why the URL can be read
 * out of it.
 */
export const DEVOPS_FILE = "delivery/devops.md";

/**
 * Where the screenshots go: INSIDE the docs folder, so they are pushed,
 * deployed and promoted with the pages that show them (req-017) — and so the
 * "write only into site/user-docs/" rule of the Doku task still holds.
 */
export const SCREENSHOT_DIR = `${USER_DOCS_DIR}/assets/screenshots`;

/**
 * How many pages one run shoots at most. A cap, not a target: the docs want a
 * handful of telling pictures, and every extra page costs a page load against a
 * live environment.
 */
export const MAX_SHOTS = 5;

/** Desktop-ish window every shot is taken in, so the pictures match each other. */
export const VIEWPORT = { width: 1280, height: 800 };

/** How long one page may take to load before it counts as "no picture". */
export const PAGE_TIMEOUT_MS = 20_000;

/** Reason noted when the repo names no dev environment to shoot at. */
export const NO_DEV_URL_MESSAGE = "keine dev-URL hinterlegt";

/** Reason noted when the run failed with nothing more specific to say. */
export const NOT_REACHABLE_MESSAGE = "nicht erreichbar";

/** One picture that was taken: which page it shows and where it lies in the repo. */
export type ShotTarget = {
  /** The app path it shows, e.g. "/" or "/verlauf". */
  page: string;
  /** File name, e.g. "start.png". */
  file: string;
  /** Repo-relative path, e.g. "site/user-docs/assets/screenshots/start.png". */
  rel: string;
};

/** One picture that was NOT taken, and why — this is what the Verlauf reports. */
export type MissingShot = { page: string; reason: string };

export type ShotResult = { shot: ShotTarget[]; missing: MissingShot[] };

/**
 * The browser seam. One call per page: open it, write the picture, and hand back
 * the links the page offers so the crawl can go on. Throwing means "no picture
 * of this page" and nothing worse.
 */
export type ShotDriver = {
  shoot: (url: string, filePath: string) => Promise<string[]>;
  close: () => Promise<void>;
};

export type CaptureDeps = {
  /** Opens the browser. Injectable, so the crawl is testable without one. */
  openDriver?: () => Promise<ShotDriver>;
  /** Creates the folder a picture is written into. */
  ensureDir?: (dirPath: string) => Promise<void>;
  maxShots?: number;
};

/** The `## Environments` section of devops.md — a machine contract per the skill. */
const ENV_HEADING = /^#{1,6}\s+.*(environments|umgebungen)/i;
const ANY_HEADING = /^#{1,6}\s/;
/** A cell that is a URL and nothing else: no prose, no placeholder. */
const URL_CELL = /^https?:\/\/[^\s|]+$/i;
/** Everything before the path of an absolute URL: scheme + host (+ port). */
const ORIGIN = /^(https?:\/\/[^/]+)/i;

/**
 * Read one table cell as a bare value: strips the decoration a hand-written line
 * carries (backticks, quotes, an autolink's angle brackets, a markdown link, a
 * trailing period). What is left is only accepted as a URL if it really is one,
 * which is what makes the skill's own `<TODO: dev/staging URL>` placeholder
 * count as "no dev environment" rather than as a host named TODO.
 */
function cellValue(raw: string): string {
  let v = raw.trim();
  const link = v.match(/\[[^\]]*\]\(([^)]+)\)/);
  if (link) v = link[1];
  return v
    .replace(/[`"'<>]/g, "")
    .trim()
    .replace(/[.,;]+$/, "")
    .trim();
}

/**
 * Where the app's dev environment runs according to the repo's devops.md, or
 * null when the file names none — no file, no Environments section, no dev row,
 * an unfilled placeholder. Null is the answer that leaves the docs without
 * pictures instead of shooting at a guessed host (req-017).
 *
 * Only the Environments section is read and only its `dev` row, so the prod URL
 * one line below can never be mistaken for it — screenshots are taken against
 * dev and nothing else.
 */
export function devUrlFrom(devops: string | null | undefined): string | null {
  if (!devops) return null;
  const lines = devops.split("\n");
  const start = lines.findIndex((l) => ENV_HEADING.test(l.trim()));
  if (start < 0) return null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (ANY_HEADING.test(line)) break; // next section: the table is over
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(cellValue);
    if (cells.length < 2) continue;
    if (cells[0].toLowerCase() !== "dev") continue; // header, separator, prod row
    const url = cells.slice(1).find((c) => URL_CELL.test(c));
    if (url) return url.replace(/\/+$/, "");
  }
  return null;
}

/** Scheme + host of an absolute URL, or null when it is not one. */
function originOf(url: string): string | null {
  const m = url.match(ORIGIN);
  return m ? m[1] : null;
}

/**
 * File name for a page's picture: "/" -> "start.png", "/verlauf" ->
 * "verlauf.png", "/repos/neu" -> "repos-neu.png". Derived from the path and
 * nothing else, so the same page keeps the same file on every run — an
 * incremental doc update must not have to re-link its images (req-016).
 *
 * `taken` keeps two different paths that slug to the same name apart, and is
 * extended by every call, so a caller can hand the same set through a crawl.
 */
export function shotTarget(page: string, taken: Set<string> = new Set()): ShotTarget {
  const slug =
    page
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "start";
  let name = slug;
  for (let n = 2; taken.has(name); n++) name = `${slug}-${n}`;
  taken.add(name);
  const file = `${name}.png`;
  return { page, file, rel: `${SCREENSHOT_DIR}/${file}` };
}

/**
 * The in-app pages among `hrefs`, as clean paths, deduplicated and sorted.
 * Sorted because the crawl must visit the same pages in the same order on every
 * run: which pages the docs show is not allowed to change just because a link
 * moved (req-016).
 *
 * Anything that leaves the app is dropped — other hosts, mail links, anchors —
 * and so is anything that ends in a file extension: a PDF or a stylesheet is no
 * page to photograph.
 */
export function internalPaths(hrefs: string[], baseUrl: string): string[] {
  const origin = originOf(baseUrl);
  const out = new Set<string>();
  for (const raw of hrefs) {
    const href = (raw ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("//")) continue;

    let p: string | null = null;
    if (href.startsWith("/")) {
      p = href;
    } else if (/^https?:\/\//i.test(href) && origin) {
      const sameHost = href.toLowerCase().startsWith(`${origin.toLowerCase()}/`);
      if (href.toLowerCase() === origin.toLowerCase()) p = "/";
      else if (sameHost) p = href.slice(origin.length);
    }
    if (!p || !p.startsWith("/")) continue;

    p = p.split("#")[0].split("?")[0];
    if (!p.startsWith("/")) continue;
    p = p.length > 1 ? p.replace(/\/+$/, "") || "/" : "/";
    const last = p.split("/").pop() ?? "";
    if (last.includes(".")) continue; // an asset, not a page
    out.add(p);
  }
  return [...out].sort();
}

/** Short, loggable reason for a picture that was not taken. */
function shotFailure(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
    .split("\n")[0]
    .trim();
  return msg ? msg.slice(0, 120) : NOT_REACHABLE_MESSAGE;
}

/**
 * What the Verlauf says about this run's pictures (req-017). Empty when nothing
 * was attempted at all; otherwise it always names how many pictures there are
 * AND every page that stayed without one — a missing screenshot has to be
 * visible in the Verlauf, not silently absent from the docs.
 */
export function screenshotNote(result: ShotResult): string {
  const { shot, missing } = result;
  if (shot.length === 0 && missing.length === 0) return "";
  const parts = [shot.length ? `Screenshots: ${shot.length}` : "keine Screenshots"];
  if (missing.length) {
    parts.push(
      `ohne Bild: ${missing.map((m) => `${m.page} (${m.reason})`).join("; ")}`,
    );
  }
  return parts.join(", ");
}

/**
 * Photograph the running dev environment into the docs folder of `dir` and
 * report what came back (req-017).
 *
 * Starts at the app's start page and follows its in-app links until MAX_SHOTS
 * pages are done — the worker decides the selection, the docs decide the
 * placement. Every failure is collected instead of thrown: an unreachable
 * environment yields a result with no pictures and a reason, and the Doku run
 * carries on and builds the docs without them.
 */
export async function captureDocScreenshots(
  dir: string,
  baseUrl: string | null,
  deps: CaptureDeps = {},
): Promise<ShotResult> {
  const shot: ShotTarget[] = [];
  const missing: MissingShot[] = [];
  const maxShots = deps.maxShots ?? MAX_SHOTS;
  const ensureDir =
    deps.ensureDir ?? ((p: string) => fs.mkdir(p, { recursive: true }).then(() => {}));

  if (!baseUrl) return { shot, missing: [{ page: "/", reason: NO_DEV_URL_MESSAGE }] };
  if (maxShots <= 0) return { shot, missing };
  const base = baseUrl.replace(/\/+$/, "");

  let driver: ShotDriver;
  try {
    driver = await (deps.openDriver ?? openChromium)();
  } catch (err) {
    // No browser at all: every page stays without a picture, and the run says so
    // once instead of repeating the same reason for each page.
    return { shot, missing: [{ page: "/", reason: shotFailure(err) }] };
  }

  const taken = new Set<string>();
  const queue = ["/"];
  const seen = new Set(queue);
  try {
    while (queue.length > 0 && shot.length < maxShots) {
      const page = queue.shift() as string;
      try {
        const target = shotTarget(page, taken);
        const file = path.join(dir, target.rel);
        await ensureDir(path.dirname(file));
        const hrefs = await driver.shoot(`${base}${page}`, file);
        shot.push(target);
        for (const next of internalPaths(hrefs, base)) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      } catch (err) {
        missing.push({ page, reason: shotFailure(err) });
      }
    }
  } finally {
    await driver.close().catch(() => {});
  }
  return { shot, missing };
}

/**
 * The real browser: headless Chromium via Playwright. `playwright-core` ships no
 * browser of its own, so the executable comes from the image (CHROMIUM_PATH);
 * without one the launch throws — which is a run without pictures, not a failed
 * Doku run.
 *
 * Imported dynamically, because the web app has no business loading a browser
 * driver: only the Doku task ever gets here.
 */
export async function openChromium(): Promise<ShotDriver> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // No sandbox and no /dev/shm: the worker runs as an unprivileged user in a
    // container, where Chromium's own sandbox cannot start.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: VIEWPORT });
  return {
    async shoot(url: string, filePath: string): Promise<string[]> {
      const page = await context.newPage();
      try {
        const res = await page.goto(url, {
          waitUntil: "load",
          timeout: PAGE_TIMEOUT_MS,
        });
        // A 404 or a 500 is a broken page, and a broken page is no illustration.
        if (res && !res.ok()) throw new Error(`HTTP ${res.status()}`);
        await page.screenshot({ path: filePath });
        return await page.$$eval("a[href]", (links) =>
          links.map((a) => a.getAttribute("href") ?? ""),
        );
      } finally {
        await page.close().catch(() => {});
      }
    },
    async close(): Promise<void> {
      await browser.close().catch(() => {});
    },
  };
}
