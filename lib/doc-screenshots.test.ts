import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_SHOTS,
  NO_DEV_URL_MESSAGE,
  NO_DRIVER_MESSAGE,
  PAGE_TIMEOUT_MS,
  PLAYWRIGHT_PACKAGE,
  SCREENSHOT_DIR,
  VIEWPORT,
  captureDocScreenshots,
  devUrlFrom,
  internalPaths,
  openChromium,
  screenshotNote,
  shotTarget,
  type PlaywrightModule,
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

// bug-006: the browser driver is an OPTIONAL package — only the Doku task ever
// drives a browser, and only the worker image carries a Chromium for it. This
// module hangs under the worker loop, so a driver named in a plain import took
// three unrelated test files down with it the moment it was not installed. What
// is pinned here: the name reaches no import the tools resolve while they process
// the file, and a driver that cannot be loaded costs pictures and nothing else.

describe("the browser driver is optional (bug-006)", () => {
  /** The module as it stands on disk — the import statements are the thing under test. */
  // Resolved from cwd, not import.meta.url: under Vitest the module URL is not a
  // file:// URL on every OS, which made new URL()/fileURLToPath() throw on Windows.
  const SOURCE = readFileSync(
    path.join(process.cwd(), "lib", "doc-screenshots.ts"),
    "utf8",
  );

  it("repro: names the driver in no import that vitest, tsc or Next can resolve", () => {
    // Each of these three resolves the specifier while it PROCESSES the file,
    // whether or not the code ever runs — which is what made a missing optional
    // package an unloadable module.
    for (const form of [
      `from\\s*["'\`]${PLAYWRIGHT_PACKAGE}`,
      `import\\s*\\(\\s*["'\`]${PLAYWRIGHT_PACKAGE}`,
      `require\\s*\\(\\s*["'\`]${PLAYWRIGHT_PACKAGE}`,
    ]) {
      expect(SOURCE).not.toMatch(new RegExp(form));
    }
  });

  it("keeps the driver's name, so a run can still load it", () => {
    expect(PLAYWRIGHT_PACKAGE).toBe("playwright-core");
    expect(SOURCE).toContain("PLAYWRIGHT_PACKAGE");
  });

  it("a driver that is not installed says so instead of quoting the resolver", async () => {
    await expect(
      openChromium(async () => {
        throw new Error("Cannot find package 'playwright-core' imported from /app/lib");
      }),
    ).rejects.toThrow(NO_DRIVER_MESSAGE);
  });

  it("a package without a launcher counts as no driver either", async () => {
    await expect(openChromium(async () => ({}) as PlaywrightModule)).rejects.toThrow(
      NO_DRIVER_MESSAGE,
    );
  });

  it("AC: no driver means no pictures — the Doku run itself carries on", async () => {
    const res = await captureDocScreenshots("/work/appbaua", "https://dev.appbaua.com", {
      openDriver: () =>
        openChromium(async () => {
          throw new Error("Cannot find package 'playwright-core'");
        }),
      ensureDir: async () => {},
    });
    expect(res.shot).toEqual([]);
    expect(res.missing).toEqual([{ page: "/", reason: NO_DRIVER_MESSAGE }]);
    expect(screenshotNote(res)).toContain(NO_DRIVER_MESSAGE);
  });
});

describe("openChromium (req-017)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Anchor stand-ins: the extractor reads nothing off them but the href. */
  function anchors(hrefs: string[]): Element[] {
    return hrefs.map((h) => ({ getAttribute: () => h })) as unknown as Element[];
  }

  /**
   * Playwright stand-in, so the launch path is testable on a machine with neither
   * the package nor a browser — which is every machine but the worker image.
   */
  function fakePlaywright(page: { ok?: boolean; status?: number; hrefs?: string[] } = {}) {
    const seen = {
      launch: null as { executablePath?: string; args: string[] } | null,
      viewport: null as unknown,
      goto: [] as { url: string; waitUntil: string; timeout: number }[],
      shots: [] as string[],
      selector: "",
      pagesClosed: 0,
      browserClosed: 0,
    };
    const mod: PlaywrightModule = {
      chromium: {
        launch: async (opts) => {
          seen.launch = opts;
          return {
            newContext: async ({ viewport }) => {
              seen.viewport = viewport;
              return {
                newPage: async () => ({
                  goto: async (url, o) => {
                    seen.goto.push({ url, ...o });
                    return { ok: () => page.ok ?? true, status: () => page.status ?? 200 };
                  },
                  screenshot: async ({ path }) => {
                    seen.shots.push(path);
                  },
                  $$eval: async (selector, fn) => {
                    seen.selector = selector;
                    return fn(anchors(page.hrefs ?? []));
                  },
                  close: async () => {
                    seen.pagesClosed++;
                  },
                }),
              };
            },
            close: async () => {
              seen.browserClosed++;
            },
          };
        },
      },
    };
    return { mod, seen };
  }

  it("writes the picture and hands back the page's links", async () => {
    const { mod, seen } = fakePlaywright({ hrefs: ["/verlauf", "https://example.com/x"] });
    const driver = await openChromium(async () => mod);

    const hrefs = await driver.shoot("https://dev.appbaua.com/", "/tmp/start.png");

    expect(seen.shots).toEqual(["/tmp/start.png"]);
    expect(hrefs).toEqual(["/verlauf", "https://example.com/x"]);
    expect(seen.selector).toBe("a[href]");
    expect(seen.goto).toEqual([
      {
        url: "https://dev.appbaua.com/",
        waitUntil: "load",
        timeout: PAGE_TIMEOUT_MS,
      },
    ]);
    expect(seen.viewport).toEqual(VIEWPORT);
    expect(seen.pagesClosed).toBe(1); // no page left open per shot
  });

  it("takes the browser out of the image and starts it without a sandbox", async () => {
    vi.stubEnv("CHROMIUM_PATH", "/usr/bin/chromium-browser");
    const { mod, seen } = fakePlaywright();

    await openChromium(async () => mod);

    expect(seen.launch?.executablePath).toBe("/usr/bin/chromium-browser");
    expect(seen.launch?.args).toEqual(["--no-sandbox", "--disable-dev-shm-usage"]);
  });

  it("lets Playwright pick the browser when the image names none", async () => {
    vi.stubEnv("CHROMIUM_PATH", "");
    const { mod, seen } = fakePlaywright();

    await openChromium(async () => mod);

    expect(seen.launch?.executablePath).toBeUndefined();
  });

  it("a broken page is no illustration", async () => {
    const { mod, seen } = fakePlaywright({ ok: false, status: 500 });
    const driver = await openChromium(async () => mod);

    await expect(driver.shoot("https://dev.appbaua.com/", "/tmp/start.png")).rejects.toThrow(
      "HTTP 500",
    );
    expect(seen.shots).toEqual([]); // nothing written for a page that failed
    expect(seen.pagesClosed).toBe(1); // and the tab is gone all the same
  });

  it("closes the browser when the run is over", async () => {
    const { mod, seen } = fakePlaywright();
    const driver = await openChromium(async () => mod);

    await driver.close();

    expect(seen.browserClosed).toBe(1);
  });
});
