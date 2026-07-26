import { describe, it, expect, vi } from "vitest";
import {
  CLAUDE_MD,
  COMMIT_MESSAGE,
  FALLBACK_CLAUDE_MD,
  GITKEEP,
  applyAppbauaStandard,
  queueAppbauaStandard,
  skillNames,
  summaryMessage,
  type ConvertDeps,
} from "./appbaua-standard";
import { NO_CHANGES_DETAIL } from "./workspace";

// req-012: one click makes a repo "appbaua-fähig" — it gets every skill and the
// empty delivery folder structure, pushed to its own branch. The source is
// the appbaua repo, read at runtime, so nothing here may depend on a hardcoded
// list of skills or folders.
//
// req-013 settles which branch that is: the target's `dev` when it has one,
// otherwise its default branch — and never a freshly created `dev`. Picking it
// happens in prepareRepoOnDevOrDefault (workspace.test.ts); here it arrives as
// the branch prepareTarget reports, and what matters is that the push and the
// result message follow it.

const SRC = "/work/appbaua";
const TGT = "/work/leer-repo";
const SOURCE_URL = "github.com/kruianer/appbaua";
const TARGET_URL = "github.com/kruianer/leer-repo";
const TOKEN = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

/** The six skills the source offers in these tests (AC: "appbaua hat 6 Skills"). */
const SKILLS = [
  "capture-bug",
  "capture-requirement",
  "setup-devops",
  "setup-idea-direction",
  "setup-stack",
  "setup-vision",
];

/** The five delivery folders of the source (AC: "5 delivery-Ordner"). */
const STRUCTURE = [
  "delivery/idea",
  "delivery/idea/done",
  "delivery/requirements",
  "delivery/requirements/done",
  "delivery/requirements/ready",
];

/**
 * In-memory stand-in for a git working copy: a map of files plus the folders
 * that exist, which is exactly what the rollout reads and writes. Lets every AC
 * be checked without git or a filesystem.
 */
function fakeFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const mkdir = (rel: string) => {
    const parts = rel.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  };
  const write = (rel: string, content: string) => {
    files.set(rel, content);
    const parent = rel.split("/").slice(0, -1).join("/");
    if (parent) mkdir(parent);
  };

  return {
    files,
    dirs,
    mkdir,
    write,
    exists: (rel: string) => files.has(rel) || dirs.has(rel),
    /** Direct children of `rel` — empty means git would not carry the folder. */
    entries: (rel: string) => {
      const prefix = `${rel}/`;
      const names = new Set<string>();
      for (const p of [...files.keys(), ...dirs]) {
        if (!p.startsWith(prefix)) continue;
        names.add(p.slice(prefix.length).split("/")[0]);
      }
      return [...names].sort();
    },
    tree: (rel: string) => ({
      dirs: [...dirs].filter((d) => d.startsWith(`${rel}/`)).sort(),
      files: [...files.keys()].filter((f) => f.startsWith(`${rel}/`)).sort(),
    }),
    /** Comparable snapshot, for "running it again changes nothing". */
    snapshot: () =>
      JSON.stringify({
        files: [...files.entries()].sort(),
        dirs: [...dirs].sort(),
      }),
  };
}

type Fake = ReturnType<typeof fakeFs>;

/** The appbaua repo as the rollout finds it: skills, structure, own content. */
function appbauaSource(): Fake {
  const src = fakeFs();
  for (const name of SKILLS) {
    src.write(`.claude/skills/${name}/SKILL.md`, `# ${name} (appbaua-Stand)`);
  }
  // A skill made of several files is still ONE skill.
  src.write(".claude/skills/capture-bug/references/beispiel.md", "Beispiel");
  src.write(".claude/templates/CLAUDE.md", "# <Projektname>\n\nStarter.\n");
  for (const dir of STRUCTURE) src.mkdir(dir);
  // Instruction files in the delivery root and appbaua's own work items: never
  // copied, so a target repo cannot inherit appbaua's stack or requirements.
  src.write("delivery/stack.md", "appbaua-Stack");
  src.write("delivery/devops.md", "appbaua-DevOps");
  src.write("delivery/vision.md", "appbaua-Vision");
  src.write("delivery/idea-direction.md", "appbaua-Ideenrichtung");
  src.write("delivery/deploy-setup.md", "appbaua-Deploy");
  src.write("delivery/requirements/ready/req-001-repo-verwaltung.md", "req-001");
  src.write("delivery/idea/warum-jetzt.md", "appbaua-Idee");
  src.write("CLAUDE.md", "# appbaua\n\nAreas: Worker-Steuerung …");
  return src;
}

function deps(
  src: Fake,
  tgt: Fake,
  over: Partial<ConvertDeps> = {},
): Partial<ConvertDeps> {
  const pick = (dir: string): Fake => (dir === SRC ? src : tgt);
  return {
    token: TOKEN,
    sourceUrl: SOURCE_URL,
    prepareRepo: vi.fn(async (_url: string) => SRC),
    prepareTarget: vi.fn(async (_url: string) => ({ dir: TGT, branch: "dev" })),
    listTree: vi.fn(async (dir: string, rel: string) => pick(dir).tree(rel)),
    listEntries: vi.fn(async (dir: string, rel: string) => pick(dir).entries(rel)),
    pathExists: vi.fn(async (dir: string, rel: string) => pick(dir).exists(rel)),
    ensureDir: vi.fn(async (dir: string, rel: string) => {
      pick(dir).mkdir(rel);
    }),
    copyFile: vi.fn(
      async (fromDir: string, fromRel: string, toDir: string, toRel: string) => {
        const content = pick(fromDir).files.get(fromRel);
        if (content === undefined) throw new Error(`nicht vorhanden: ${fromRel}`);
        pick(toDir).write(toRel, content);
      },
    ),
    readFile: vi.fn(
      async (dir: string, rel: string) => pick(dir).files.get(rel) ?? null,
    ),
    writeFile: vi.fn(async (dir: string, rel: string, content: string) => {
      pick(dir).write(rel, content);
    }),
    commitAndPush: vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    })),
    discardChanges: vi.fn(async (_dir: string) => {}),
    ...over,
  };
}

/** A rollout that succeeded; fails the test instead of narrowing by hand. */
async function convert(
  src: Fake,
  tgt: Fake,
  over: Partial<ConvertDeps> = {},
): Promise<{
  message: string;
  skills: number;
  folders: number;
  branch: string;
}> {
  const res = await applyAppbauaStandard(TARGET_URL, deps(src, tgt, over));
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  return {
    message: res.message,
    skills: res.summary.skills,
    folders: res.summary.folders,
    branch: res.summary.branch,
  };
}

describe("Umstellung auf appbaua — leeres Repo (req-012)", () => {
  it("AC: alle Skills und die leere delivery-Struktur liegen im Zielrepo", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    await convert(src, tgt);

    for (const name of SKILLS) {
      expect(tgt.files.get(`.claude/skills/${name}/SKILL.md`)).toBe(
        `# ${name} (appbaua-Stand)`,
      );
    }
    expect(tgt.files.get(".claude/skills/capture-bug/references/beispiel.md")).toBe(
      "Beispiel",
    );
    for (const dir of STRUCTURE) expect(tgt.dirs.has(dir)).toBe(true);
  });

  it("AC: die Struktur kommt LEER an — keine Inhalte der appbaua-Ordner", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    await convert(src, tgt);

    expect(
      tgt.files.has("delivery/requirements/ready/req-001-repo-verwaltung.md"),
    ).toBe(false);
    expect(tgt.files.has("delivery/idea/warum-jetzt.md")).toBe(false);
  });

  it("AC: die Instruktions-Dateien im delivery-Root werden nie kopiert", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    await convert(src, tgt);

    for (const file of [
      "delivery/devops.md",
      "delivery/stack.md",
      "delivery/vision.md",
      "delivery/idea-direction.md",
      "delivery/deploy-setup.md",
    ]) {
      expect(tgt.files.has(file)).toBe(false);
    }
  });

  it("gepusht wird genau einmal, mit einem Commit auf den dev-Branch", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));

    const res = await convert(src, tgt, { commitAndPush });

    expect(commitAndPush).toHaveBeenCalledTimes(1);
    expect(commitAndPush).toHaveBeenCalledWith(TGT, COMMIT_MESSAGE, TOKEN, {
      branch: "dev",
    });
    expect(res.message).toContain("auf dev gepusht");
  });

  it("leere Ordner bekommen ein .gitkeep, damit git sie überhaupt tragen kann", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    await convert(src, tgt);

    // Blätter der Struktur sind leer -> Platzhalter.
    expect(tgt.files.has(`delivery/idea/done/${GITKEEP}`)).toBe(true);
    expect(tgt.files.has(`delivery/requirements/ready/${GITKEEP}`)).toBe(true);
    // Ordner, die Unterordner enthalten, brauchen keinen.
    expect(tgt.files.has(`delivery/requirements/${GITKEEP}`)).toBe(false);
    expect(tgt.files.has(`delivery/${GITKEEP}`)).toBe(false);
  });

  it("die Quelle wird frisch geholt und selbst nicht verändert", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const before = src.snapshot();
    const prepareRepo = vi.fn(async (_url: string) => SRC);
    const prepareTarget = vi.fn(async (_url: string) => ({
      dir: TGT,
      branch: "dev",
    }));

    await convert(src, tgt, { prepareRepo, prepareTarget });

    expect(prepareRepo).toHaveBeenCalledWith(SOURCE_URL, TOKEN);
    expect(prepareTarget).toHaveBeenCalledWith(TARGET_URL, TOKEN);
    expect(src.snapshot()).toBe(before);
  });
});

describe("Rückmeldung am Button (req-012)", () => {
  it("AC: die Meldung nennt 6 Skills, 5 delivery-Ordner und den Ziel-Branch dev", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    const res = await convert(src, tgt);

    expect(res.skills).toBe(6);
    expect(res.folders).toBe(5);
    expect(res.message).toContain("6 Skills");
    expect(res.message).toContain("5 delivery-Ordner");
    expect(res.message).toContain("Ziel-Branch: dev");
  });

  it("zählt einen Skill aus mehreren Dateien als einen Skill", () => {
    expect(
      skillNames([
        ".claude/skills/capture-bug",
        ".claude/skills/capture-bug/references",
        ".claude/skills/setup-stack",
      ]),
    ).toEqual(["capture-bug", "setup-stack"]);
  });

  it("die Meldung ist im Singular korrekt und nennt neue Ordner nur, wenn es welche gab", () => {
    const base = {
      skills: 1,
      folders: 3,
      claudeMd: "angelegt" as const,
      branch: "dev",
      pushDetail: "auf dev gepusht",
    };
    expect(summaryMessage({ ...base, foldersCreated: 0 })).toContain("1 Skill kopiert");
    expect(summaryMessage({ ...base, foldersCreated: 0 })).not.toContain("neu)");
    expect(summaryMessage({ ...base, foldersCreated: 2 })).toContain(
      "3 delivery-Ordner (2 neu)",
    );
  });
});

describe("Ziel-Branch der Umstellung (req-013)", () => {
  /** A rollout whose target repo was checked out on `branch`. */
  const onBranch = (branch: string) => ({
    prepareTarget: vi.fn(async () => ({ dir: TGT, branch })),
    commitAndPush: vi.fn(async () => ({
      pushed: true,
      detail: `auf ${branch} gepusht`,
    })),
  });

  it("AC: ohne dev-Branch im Zielrepo geht die Umstellung auf dessen main", async () => {
    const over = onBranch("main");

    const res = await convert(appbauaSource(), fakeFs(), over);

    expect(over.commitAndPush).toHaveBeenCalledWith(
      TGT,
      COMMIT_MESSAGE,
      TOKEN,
      { branch: "main" },
    );
    expect(res.branch).toBe("main");
    // Kein dev im Spiel: weder wird dorthin gepusht noch wird es genannt.
    expect(res.message).not.toContain("dev");
  });

  it("AC: hat das Zielrepo ein dev, wird wie bisher dorthin gepusht", async () => {
    const over = onBranch("dev");

    const res = await convert(appbauaSource(), fakeFs(), over);

    expect(over.commitAndPush).toHaveBeenCalledWith(
      TGT,
      COMMIT_MESSAGE,
      TOKEN,
      { branch: "dev" },
    );
    expect(res.branch).toBe("dev");
  });

  it("AC: heißt der Default-Branch master, wird master verwendet", async () => {
    const over = onBranch("master");

    const res = await convert(appbauaSource(), fakeFs(), over);

    expect(over.commitAndPush).toHaveBeenCalledWith(
      TGT,
      COMMIT_MESSAGE,
      TOKEN,
      { branch: "master" },
    );
    expect(res.branch).toBe("master");
    expect(res.message).not.toContain("main");
  });

  it("AC: die Ergebnismeldung nennt den tatsächlich verwendeten Ziel-Branch", async () => {
    const res = await convert(appbauaSource(), fakeFs(), onBranch("master"));

    expect(res.message).toContain("Ziel-Branch: master");
    expect(res.message).toContain("auf master gepusht");
  });

  it("war schon alles auf Stand, nennt die Meldung trotzdem den Ziel-Branch", async () => {
    const res = await convert(appbauaSource(), fakeFs(), {
      prepareTarget: vi.fn(async () => ({ dir: TGT, branch: "master" })),
      commitAndPush: vi.fn(async () => ({
        pushed: false,
        detail: NO_CHANGES_DETAIL,
      })),
    });

    expect(res.message).toContain("Ziel-Branch: master");
    expect(res.message).toContain("keine Änderungen nötig");
  });
});

describe("CLAUDE.md (req-012)", () => {
  it("AC: eine vorhandene CLAUDE.md bleibt unverändert", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    tgt.write(CLAUDE_MD, "# mein-repo\n\nHandgeschrieben.");

    const res = await convert(src, tgt);

    expect(tgt.files.get(CLAUDE_MD)).toBe("# mein-repo\n\nHandgeschrieben.");
    expect(res.message).toContain("CLAUDE.md unverändert");
  });

  it("AC: ohne CLAUDE.md wird eine neue angelegt", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    const res = await convert(src, tgt);

    expect(tgt.files.get(CLAUDE_MD)).toBe("# <Projektname>\n\nStarter.\n");
    expect(res.message).toContain("CLAUDE.md angelegt");
  });

  it("nicht die CLAUDE.md von appbaua selbst — die gehört appbaua", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    await convert(src, tgt);

    expect(tgt.files.get(CLAUDE_MD)).not.toContain("Worker-Steuerung");
  });

  it("ohne Vorlage in der Quelle greift die eingebaute Vorlage", async () => {
    const src = appbauaSource();
    src.files.delete(".claude/templates/CLAUDE.md");
    const tgt = fakeFs();

    await convert(src, tgt);

    expect(tgt.files.get(CLAUDE_MD)).toBe(FALLBACK_CLAUDE_MD);
  });
});

describe("Aktualisieren eines bereits umgestellten Repos (req-012)", () => {
  it("AC: ein älterer Skill wird überschrieben, eine eigene delivery/stack.md nicht", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    tgt.write(".claude/skills/capture-bug/SKILL.md", "# capture-bug (alt)");
    tgt.write("delivery/stack.md", "Mein eigener Stack");

    await convert(src, tgt);

    expect(tgt.files.get(".claude/skills/capture-bug/SKILL.md")).toBe(
      "# capture-bug (appbaua-Stand)",
    );
    expect(tgt.files.get("delivery/stack.md")).toBe("Mein eigener Stack");
  });

  it("AC: ein vorhandener Ordner mit Inhalt wird nicht geleert", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    tgt.write("delivery/requirements/ready/req-042-eigenes.md", "mein Requirement");

    await convert(src, tgt);

    expect(tgt.files.get("delivery/requirements/ready/req-042-eigenes.md")).toBe(
      "mein Requirement",
    );
    // Ein Ordner mit Inhalt braucht keinen Platzhalter und bekommt keinen.
    expect(tgt.files.has(`delivery/requirements/ready/${GITKEEP}`)).toBe(false);
  });

  it("AC: ein Skill, den nur das Zielrepo hat, bleibt erhalten", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    tgt.write(".claude/skills/eigener-skill/SKILL.md", "# eigener-skill");

    await convert(src, tgt);

    expect(tgt.files.get(".claude/skills/eigener-skill/SKILL.md")).toBe(
      "# eigener-skill",
    );
  });

  it("zählt nur die Ordner als neu, die wirklich gefehlt haben", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    tgt.write("delivery/requirements/ready/req-042-eigenes.md", "x");

    const res = await applyAppbauaStandard(TARGET_URL, deps(src, tgt));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // vorhanden: delivery/requirements + .../ready -> es fehlten drei
    expect(res.summary.folders).toBe(5);
    expect(res.summary.foldersCreated).toBe(3);
  });

  it("AC: ein zweiter Lauf führt zum selben Zustand und pusht nichts", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    await convert(src, tgt);
    const afterFirst = tgt.snapshot();

    // Nichts mehr zu committen: genau das meldet commitAndPush dann.
    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, {
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: NO_CHANGES_DETAIL,
        })),
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(tgt.snapshot()).toBe(afterFirst);
    expect(res.message).toContain("keine Änderungen nötig");
  });
});

describe("Abbruch ohne Push (req-012)", () => {
  it("AC: ein unerreichbares Zielrepo bricht ab, bevor irgendetwas gepusht wird", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));

    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, {
        prepareTarget: vi.fn(async () => {
          throw new Error("clone failed: repository not found");
        }),
        commitAndPush,
      }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Zielrepo konnte nicht vorbereitet werden");
    expect(res.error).toContain("repository not found");
    expect(commitAndPush).not.toHaveBeenCalled();
    expect(tgt.snapshot()).toBe(fakeFs().snapshot()); // unangetastet
  });

  it("AC: ohne Push-Zugriff ist die Umstellung ein Fehler mit konkretem Grund", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const discardChanges = vi.fn(async (_dir: string) => {});

    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, {
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: "push failed: permission denied",
        })),
        discardChanges,
      }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Nichts gepusht");
    expect(res.error).toContain("permission denied");
    // Die halbfertige Arbeitskopie bleibt nicht liegen.
    expect(discardChanges).toHaveBeenCalledWith(TGT);
  });

  it("eine unerreichbare Quelle bricht ab, ohne das Zielrepo anzufassen", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const prepareRepo = vi.fn(async () => {
      throw new Error("fetch failed: no route to host");
    });
    const prepareTarget = vi.fn(async () => ({ dir: TGT, branch: "dev" }));

    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, { prepareRepo, prepareTarget }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("appbaua-Quelle konnte nicht geholt werden");
    expect(prepareTarget).not.toHaveBeenCalled(); // Ziel nie geklont
  });

  it("ein Schreibfehler mitten im Ausrollen pusht nichts und wird verworfen", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const discardChanges = vi.fn(async (_dir: string) => {});

    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, {
        copyFile: vi.fn(async () => {
          throw new Error("Platte voll");
        }),
        commitAndPush,
        discardChanges,
      }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Umstellung abgebrochen, nichts gepusht");
    expect(res.error).toContain("Platte voll");
    expect(commitAndPush).not.toHaveBeenCalled();
    expect(discardChanges).toHaveBeenCalledWith(TGT);
  });

  it("ohne Token wird gar nicht erst geklont", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();
    const prepareRepo = vi.fn(async () => SRC);
    const prepareTarget = vi.fn(async () => ({ dir: TGT, branch: "dev" }));

    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, { token: undefined, prepareRepo, prepareTarget }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Kein GitHub-Token");
    expect(prepareRepo).not.toHaveBeenCalled();
    expect(prepareTarget).not.toHaveBeenCalled();
  });

  it("appbaua selbst ist die Quelle und wird nicht auf sich umgestellt", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    const res = await applyAppbauaStandard(
      `https://${SOURCE_URL}.git`,
      deps(src, tgt),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Quelle des appbaua-Standards");
  });

  it("keine Fehlermeldung trägt den Token nach draußen (bug-003)", async () => {
    const src = appbauaSource();
    const tgt = fakeFs();

    const res = await applyAppbauaStandard(
      TARGET_URL,
      deps(src, tgt, {
        prepareTarget: vi.fn(async () => {
          throw new Error(
            `fatal: could not read from 'https://x-access-token:${TOKEN}@github.com/kruianer/leer-repo.git'`,
          );
        }),
      }),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toContain(TOKEN);
  });
});

describe("Umstellungen laufen nacheinander (req-012)", () => {
  it("zwei Klicks überlappen sich nicht — sie teilen sich die Arbeitsordner", async () => {
    const src = appbauaSource();
    const order: string[] = [];
    let running = 0;
    let maxParallel = 0;

    const slow = (tgt: Fake, label: string) =>
      deps(src, tgt, {
        prepareTarget: vi.fn(async () => {
          running += 1;
          maxParallel = Math.max(maxParallel, running);
          order.push(`start ${label}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
          order.push(`ende ${label}`);
          return { dir: TGT, branch: "dev" };
        }),
      });

    const first = queueAppbauaStandard(TARGET_URL, slow(fakeFs(), "a"));
    const second = queueAppbauaStandard(TARGET_URL, slow(fakeFs(), "b"));
    const [a, b] = await Promise.all([first, second]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(maxParallel).toBe(1);
    expect(order).toEqual(["start a", "ende a", "start b", "ende b"]);
  });

  it("ein gescheiterter Lauf blockiert den nächsten nicht", async () => {
    const src = appbauaSource();
    const failing = await queueAppbauaStandard(
      TARGET_URL,
      deps(src, fakeFs(), { token: undefined }),
    );
    const next = await queueAppbauaStandard(TARGET_URL, deps(src, fakeFs()));

    expect(failing.ok).toBe(false);
    expect(next.ok).toBe(true);
  });
});
