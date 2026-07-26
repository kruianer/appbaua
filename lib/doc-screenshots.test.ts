import { describe, it, expect, vi } from "vitest";
import {
  MAX_SHOTS,
  NO_DEV_URL_MESSAGE,
  SCREENSHOT_DIR,
  captureDocScreenshots,
  devUrlFrom,
  internalPaths,
  screenshotNote,
  shotTarget,
  type ShotDriver,
} from "./doc-screenshots";

// req-017: the Doku task photographs the app's RUNNING dev environment and puts
// the pictures into the docs folder. Two things are pinned here above all: the
// screenshots are taken against dev (never prod, never a local app), and a
// picture that could not be taken costs its illustration and nothing else — the
// capture never throws, it reports.

/** The devops.md the setup-devops skill writes (Setup 1), with both URLs filled in. */
const DEVOPS = [
  "---",
  "project: appbaua",
  "setup: 1",
  "---",
  "",
  "# DevOps Convention",
  "",
  "## Environments",
  "",
  "| Environment | Branch | URL                     |",
  "|-------------|--------|-------------------------|",
  "| dev         | dev    | https://dev.appbaua.com |",
  "| prod        | main   | https://app.appbaua.com |",
  "",
  "Hosting-Plattform: GitHub Actions",
  "",
  "## Deploy Trigger",
  "",
  "- Push auf `dev` → deployt dev.",
].join("\n");

describe("devUrlFrom (req-017)", () => {
  it("AC: reads the dev environment out of the repo's devops.md", () => {
    expect(devUrlFrom(DEVOPS)).toBe("https://dev.appbaua.com");
  });

  it("never takes prod — screenshots are made against dev", () => {
    const url = devUrlFrom(DEVOPS);
    expect(url).not.toContain("app.appbaua.com");
  });

  it("no devops.md at all -> no dev environment", () => {
    expect(devUrlFrom(null)).toBeNull();
    expect(devUrlFrom(undefined)).toBeNull();
    expect(devUrlFrom("")).toBeNull();
  });

  it("a file without an Environments section names none", () => {
    expect(devUrlFrom("# DevOps\n\n## Deploy Trigger\n\n- Push auf dev\n")).toBeNull();
  });

  it("an unfilled placeholder is NOT a dev environment", () => {
    // What the setup-devops template literally contains until somebody fills it.
    const todo = DEVOPS.replace(
      "https://dev.appbaua.com",
      "<TODO: dev/staging URL>",
    );
    expect(devUrlFrom(todo)).toBeNull();
  });

  it("only the Environments section is read", () => {
    // Without the section boundary the URL from the prose below would pass.
    const noUrl = DEVOPS.replace("https://dev.appbaua.com", "noch nicht bekannt")
      .replace("https://app.appbaua.com", "noch nicht bekannt")
      .concat("\n\nSiehe https://dev.example.com\n");
    expect(devUrlFrom(noUrl)).toBeNull();
  });

  it("survives a translated heading and hand-written decoration", () => {
    const german = DEVOPS.replace("## Environments", "## Umgebungen").replace(
      "https://dev.appbaua.com",
      "`https://dev.appbaua.com/`",
    );
    expect(devUrlFrom(german)).toBe("https://dev.appbaua.com");
  });

  it("reads a dev row written as a markdown link", () => {
    const md = "## Environments\n\n| dev | dev | [dev](https://dev.example.com) |\n";
    expect(devUrlFrom(md)).toBe("https://dev.example.com");
  });

  it("ignores the header and the separator row", () => {
    // "Environment" and "-----" must never be mistaken for the dev row.
    const md = [
      "## Environments",
      "",
      "| Environment | Branch | URL |",
      "|-------------|--------|-----|",
      "| prod        | main   | https://app.example.com |",
    ].join("\n");
    expect(devUrlFrom(md)).toBeNull();
  });

  it("takes no relative or non-http location", () => {
    expect(devUrlFrom("## Environments\n\n| dev | dev | localhost:3000 |\n")).toBeNull();
    expect(devUrlFrom("## Environments\n\n| dev | dev | /app |\n")).toBeNull();
  });
});

describe("shotTarget (req-017)", () => {
  it("puts the pictures inside the docs, so they travel with them", () => {
    expect(SCREENSHOT_DIR).toBe("site/user-docs/assets/screenshots");
    expect(shotTarget("/").rel).toBe(`${SCREENSHOT_DIR}/start.png`);
  });

  it("derives a stable file name from the page path", () => {
    expect(shotTarget("/").file).toBe("start.png");
    expect(shotTarget("/verlauf").file).toBe("verlauf.png");
    expect(shotTarget("/repos/neu").file).toBe("repos-neu.png");
  });

  it("the same page always yields the same file — the docs keep their links", () => {
    expect(shotTarget("/verlauf").rel).toBe(shotTarget("/verlauf").rel);
  });

  it("keeps two pages that slug to the same name apart", () => {
    const taken = new Set<string>();
    expect(shotTarget("/repos/neu", taken).file).toBe("repos-neu.png");
    expect(shotTarget("/repos-neu", taken).file).toBe("repos-neu-2.png");
  });
});

describe("internalPaths (req-017)", () => {
  const base = "https://dev.appbaua.com";

  it("keeps the app's own pages, sorted and deduplicated", () => {
    expect(
      internalPaths(["/verlauf", "/repos", "/verlauf", "/"], base),
    ).toEqual(["/", "/repos", "/verlauf"]);
  });

  it("accepts absolute links to the same host as the pages they are", () => {
    expect(
      internalPaths([`${base}/verlauf`, base, `${base}/`], base),
    ).toEqual(["/", "/verlauf"]);
  });

  it("drops everything that leaves the app", () => {
    expect(
      internalPaths(
        ["https://example.com/x", "//example.com/y", "mailto:a@b.c", "#top", ""],
        base,
      ),
    ).toEqual([]);
  });

  it("drops assets — a stylesheet is no page to photograph", () => {
    expect(internalPaths(["/style.css", "/handbuch.pdf"], base)).toEqual([]);
  });

  it("strips query and hash and the trailing slash, so one page is one picture", () => {
    expect(
      internalPaths(["/verlauf?seite=2", "/verlauf#unten", "/verlauf/"], base),
    ).toEqual(["/verlauf"]);
  });

  it("sorts, so the same site is crawled in the same order on every run", () => {
    expect(internalPaths(["/b", "/a"], base)).toEqual(
      internalPaths(["/a", "/b"], base),
    );
  });
});

describe("captureDocScreenshots (req-017)", () => {
  /**
   * Browser stand-in. `pages` maps an app path to the links its page offers;
   * a path that is missing throws, which is what an unreachable or broken page
   * does to the real driver.
   */
  function driverFor(pages: Record<string, string[]>, base = "https://dev.appbaua.com") {
    const shot: string[] = [];
    const driver: ShotDriver = {
      shoot: vi.fn(async (url: string, filePath: string) => {
        const page = url.slice(base.length) || "/";
        const links = pages[page];
        if (!links) throw new Error(`net::ERR_CONNECTION_REFUSED at ${url}`);
        shot.push(filePath);
        return links;
      }),
      close: vi.fn(async () => {}),
    };
    return { driver, shot };
  }

  /** Never touch the disk in a unit test. */
  const ensureDir = async () => {};

  function capture(
    pages: Record<string, string[]>,
    over: { maxShots?: number; base?: string | null } = {},
  ) {
    const { driver, shot } = driverFor(pages);
    return {
      shot,
      driver,
      run: () =>
        captureDocScreenshots(
          "/work/appbaua",
          over.base === undefined ? "https://dev.appbaua.com" : over.base,
          { openDriver: async () => driver, ensureDir, maxShots: over.maxShots },
        ),
    };
  }

  it("AC: photographs the app and writes the pictures into the docs folder", async () => {
    const c = capture({ "/": [] });
    const res = await c.run();
    expect(res.shot).toEqual([
      { page: "/", file: "start.png", rel: `${SCREENSHOT_DIR}/start.png` },
    ]);
    expect(res.missing).toEqual([]);
    expect(c.shot).toEqual([`/work/appbaua/${SCREENSHOT_DIR}/start.png`]);
  });

  it("shoots against the dev URL it was given, starting at the start page", async () => {
    const c = capture({ "/": [] });
    await c.run();
    expect(c.driver.shoot).toHaveBeenCalledWith(
      "https://dev.appbaua.com/",
      expect.stringContaining("start.png"),
    );
  });

  it("follows the app's own links to the other pages", async () => {
    const c = capture({ "/": ["/verlauf", "/repos"], "/verlauf": [], "/repos": [] });
    const res = await c.run();
    expect(res.shot.map((s) => s.page)).toEqual(["/", "/repos", "/verlauf"]);
    expect(res.missing).toEqual([]);
  });

  it("stops at the cap instead of crawling the whole app", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`/p${i}`, []]),
    );
    const c = capture({ "/": Object.keys(many), ...many }, { maxShots: 3 });
    const res = await c.run();
    expect(res.shot).toHaveLength(3);
    expect(MAX_SHOTS).toBeGreaterThan(0);
  });

  it("visits no page twice", async () => {
    const c = capture({ "/": ["/verlauf", "/"], "/verlauf": ["/", "/verlauf"] });
    const res = await c.run();
    expect(res.shot.map((s) => s.page)).toEqual(["/", "/verlauf"]);
  });

  it("AC: a page that fails costs its picture and nothing else", async () => {
    const c = capture({ "/": ["/verlauf", "/repos"], "/repos": [] });
    const res = await c.run();
    expect(res.shot.map((s) => s.page)).toEqual(["/", "/repos"]);
    expect(res.missing).toHaveLength(1);
    expect(res.missing[0].page).toBe("/verlauf");
    expect(res.missing[0].reason).toContain("ERR_CONNECTION_REFUSED");
  });

  it("AC: an unreachable dev environment yields no picture and no error", async () => {
    const c = capture({}); // not even the start page answers
    const res = await c.run();
    expect(res.shot).toEqual([]);
    expect(res.missing).toEqual([
      { page: "/", reason: expect.stringContaining("ERR_CONNECTION_REFUSED") },
    ]);
  });

  it("AC: without a dev URL nothing is shot, and the reason says so", async () => {
    const res = await captureDocScreenshots("/work/appbaua", null, {
      openDriver: async () => {
        throw new Error("nie geöffnet");
      },
      ensureDir,
    });
    expect(res.shot).toEqual([]);
    expect(res.missing).toEqual([{ page: "/", reason: NO_DEV_URL_MESSAGE }]);
  });

  it("a browser that cannot start is a run without pictures, not a crash", async () => {
    const res = await captureDocScreenshots("/work/appbaua", "https://dev.appbaua.com", {
      openDriver: async () => {
        throw new Error("Executable doesn't exist");
      },
      ensureDir,
    });
    expect(res.shot).toEqual([]);
    expect(res.missing[0].reason).toContain("Executable doesn't exist");
  });

  it("closes the browser, also when a page failed", async () => {
    const c = capture({ "/": ["/kaputt"] });
    await c.run();
    expect(c.driver.close).toHaveBeenCalled();
  });

  it("a trailing slash on the dev URL does not double up in the page URLs", async () => {
    const { driver } = driverFor({ "/": [] });
    await captureDocScreenshots("/work/appbaua", "https://dev.appbaua.com/", {
      openDriver: async () => driver,
      ensureDir,
    });
    expect(driver.shoot).toHaveBeenCalledWith(
      "https://dev.appbaua.com/",
      expect.any(String),
    );
  });
});

describe("screenshotNote (req-017)", () => {
  const target = shotTarget("/");

  it("AC: names every page that stayed without a picture", () => {
    const note = screenshotNote({
      shot: [target],
      missing: [{ page: "/verlauf", reason: "nicht erreichbar" }],
    });
    expect(note).toContain("Screenshots: 1");
    expect(note).toContain("ohne Bild: /verlauf (nicht erreichbar)");
  });

  it("says how many pictures a clean run took", () => {
    expect(screenshotNote({ shot: [target], missing: [] })).toBe("Screenshots: 1");
  });

  it("AC: a run without any picture says so instead of staying silent", () => {
    expect(
      screenshotNote({ shot: [], missing: [{ page: "/", reason: NO_DEV_URL_MESSAGE }] }),
    ).toBe(`keine Screenshots, ohne Bild: / (${NO_DEV_URL_MESSAGE})`);
  });

  it("says nothing when nothing was attempted", () => {
    expect(screenshotNote({ shot: [], missing: [] })).toBe("");
  });
});
