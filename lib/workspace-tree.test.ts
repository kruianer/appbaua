import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyRepoFile,
  ensureRepoDir,
  listTree,
  readRepoFile,
  repoPathExists,
} from "./workspace";

// The filesystem side of req-012: reading a source repo's structure and writing
// it into another working copy. Exercised against a real temp directory, because
// that is exactly what these helpers are — the thin layer over node:fs.

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "appbaua-tree-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function seed(rel: string, content = "x") {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

describe("listTree", () => {
  it("liefert Ordner und Dateien rekursiv, sortiert und repo-relativ", async () => {
    await seed("delivery/requirements/ready/req-001.md");
    await seed("delivery/stack.md");
    await fs.mkdir(path.join(root, "delivery/idea/done"), { recursive: true });

    const tree = await listTree(root, "delivery");

    expect(tree.dirs).toEqual([
      "delivery/idea",
      "delivery/idea/done",
      "delivery/requirements",
      "delivery/requirements/ready",
    ]);
    expect(tree.files).toEqual([
      "delivery/requirements/ready/req-001.md",
      "delivery/stack.md",
    ]);
  });

  it("ein fehlender Ordner ist kein Fehler, sondern einfach leer", async () => {
    expect(await listTree(root, ".claude/skills")).toEqual({
      dirs: [],
      files: [],
    });
  });

  it("nennt jeden Skill-Ordner, egal wie tief er verschachtelt ist", async () => {
    await seed(".claude/skills/capture-bug/SKILL.md");
    await seed(".claude/skills/capture-bug/references/beispiel.md");

    const tree = await listTree(root, ".claude/skills");

    expect(tree.dirs).toEqual([
      ".claude/skills/capture-bug",
      ".claude/skills/capture-bug/references",
    ]);
    expect(tree.files).toHaveLength(2);
  });
});

describe("repoPathExists / ensureRepoDir", () => {
  it("erkennt Dateien, Ordner und Abwesenheit", async () => {
    await seed("CLAUDE.md");
    await fs.mkdir(path.join(root, "delivery"), { recursive: true });

    expect(await repoPathExists(root, "CLAUDE.md")).toBe(true);
    expect(await repoPathExists(root, "delivery")).toBe(true);
    expect(await repoPathExists(root, "delivery/bugs")).toBe(false);
  });

  it("legt verschachtelte Ordner an und stört sich nicht an vorhandenen", async () => {
    await ensureRepoDir(root, "delivery/bugs/ready");
    await ensureRepoDir(root, "delivery/bugs/ready");

    expect(await repoPathExists(root, "delivery/bugs/ready")).toBe(true);
  });
});

describe("copyRepoFile / readRepoFile", () => {
  it("kopiert in ein anderes Verzeichnis und legt den Zielordner an", async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "appbaua-tree-"));
    try {
      await seed(".claude/skills/setup-stack/SKILL.md", "# neu");

      await copyRepoFile(
        root,
        ".claude/skills/setup-stack/SKILL.md",
        other,
        ".claude/skills/setup-stack/SKILL.md",
      );

      expect(
        await readRepoFile(other, ".claude/skills/setup-stack/SKILL.md"),
      ).toBe("# neu");
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it("überschreibt eine gleichnamige Datei", async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "appbaua-tree-"));
    try {
      await seed("SKILL.md", "# neuer Stand");
      await fs.writeFile(path.join(other, "SKILL.md"), "# alter Stand", "utf8");

      await copyRepoFile(root, "SKILL.md", other, "SKILL.md");

      expect(await readRepoFile(other, "SKILL.md")).toBe("# neuer Stand");
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it("readRepoFile liefert null statt zu werfen, wenn nichts da ist", async () => {
    expect(await readRepoFile(root, ".claude/templates/CLAUDE.md")).toBeNull();
  });
});
