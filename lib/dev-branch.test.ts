import { describe, it, expect } from "vitest";
import { DEVOPS_FILE, devBranchFrom, environmentRow, isBranchName } from "./dev-branch";

// req-020: which branch the worker commits on is the TARGET repo's decision,
// and the repo states it in the `## Environments` table of its own devops.md.
// Two answers matter here above all: a table that names a branch gives that
// branch (a standard repo keeps behaving exactly as before), and a table that
// states a CONVENTION instead of a name gives no branch at all — the worker
// then stays where the repo is instead of creating a `dev` nobody asked for.

/** The devops.md the setup-devops skill writes (Setup 1) — the standard case. */
const STANDARD = [
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
  "## Deploy Trigger",
  "",
  "- Push auf `dev` → deployt dev.",
].join("\n");

/** A repo that deliberately has no `dev` branch — the case that used to break. */
const CONVENTION = [
  "# DevOps Convention",
  "",
  "## Environments",
  "",
  "| Environment | Branch                       | URL                        |",
  "|-------------|------------------------------|----------------------------|",
  "| dev         | aktueller `feature/*`-Branch | https://dev.livinggarden.io |",
  "| prod        | main                         | https://livinggarden.io     |",
].join("\n");

describe("devBranchFrom (req-020)", () => {
  it("AC: a repo whose devops.md names 'dev' keeps being worked on dev", () => {
    expect(devBranchFrom(STANDARD)).toEqual({ kind: "named", branch: "dev" });
  });

  it("AC: a repo whose dev environment is a convention names no branch", () => {
    // "aktueller feature/*-Branch" is a pattern, not a name — so there is
    // nothing to check out, and the caller stays on what the repo has.
    expect(devBranchFrom(CONVENTION)).toEqual({ kind: "current" });
  });

  it("never reads the prod row — that branch is off limits (devops.md)", () => {
    const noDev = CONVENTION.replace("| dev  ", "| test ");
    expect(devBranchFrom(noDev)).toBeNull();
  });

  it("takes any concrete name the repo uses, not just 'dev'", () => {
    for (const name of ["develop", "staging", "main", "release/2026-07"]) {
      const md = [
        "## Environments",
        "",
        "| Environment | Branch | URL |",
        "|---|---|---|",
        `| dev | ${name} | https://dev.example.com |`,
      ].join("\n");
      expect(devBranchFrom(md)).toEqual({ kind: "named", branch: name });
    }
  });

  it("reads a name that is quoted inside the cell", () => {
    const md = STANDARD.replace("| dev         | dev ", "| dev         | `dev` ");
    expect(devBranchFrom(md)).toEqual({ kind: "named", branch: "dev" });
  });

  it("reads the Branch column wherever the table puts it", () => {
    const md = [
      "## Environments",
      "",
      "| Environment | URL                     | Branch |",
      "|-------------|-------------------------|--------|",
      "| dev         | https://dev.appbaua.com | dev    |",
    ].join("\n");
    expect(devBranchFrom(md)).toEqual({ kind: "named", branch: "dev" });
  });

  it("survives a translated table", () => {
    const md = STANDARD.replace("## Environments", "## Umgebungen").replace(
      "| Environment | Branch | URL",
      "| Umgebung    | Zweig  | URL",
    );
    expect(devBranchFrom(md)).toEqual({ kind: "named", branch: "dev" });
  });

  it("says nothing when the repo says nothing", () => {
    expect(devBranchFrom(null)).toBeNull();
    expect(devBranchFrom(undefined)).toBeNull();
    expect(devBranchFrom("")).toBeNull();
    expect(devBranchFrom("# DevOps\n\n## Deploy Trigger\n\n- Push auf dev\n")).toBeNull();
  });

  it("an unfilled placeholder is no branch", () => {
    // What the setup-devops template contains until somebody fills it in.
    const todo = STANDARD.replace("| dev         | dev ", "| dev         | <TODO> ");
    expect(devBranchFrom(todo)).toBeNull();
  });

  it("an empty branch cell is no branch either", () => {
    const md = "## Environments\n\n| dev |    | https://dev.example.com |\n";
    expect(devBranchFrom(md)).toBeNull();
  });

  it("only the Environments section is read", () => {
    // Without the section boundary the branch named in the prose below would win.
    const md = [
      "## Environments",
      "",
      "| Environment | Branch | URL |",
      "|-------------|--------|-----|",
      "| prod        | main   | https://app.example.com |",
      "",
      "## Deploy Trigger",
      "",
      "| dev | dev | https://dev.example.com |",
    ].join("\n");
    expect(devBranchFrom(md)).toBeNull();
  });

  it("ignores the header and the separator row", () => {
    const md = [
      "## Environments",
      "",
      "| Environment | Branch | URL |",
      "|-------------|--------|-----|",
    ].join("\n");
    expect(devBranchFrom(md)).toBeNull();
  });

  it("reads a table that has no header row at all", () => {
    expect(devBranchFrom("## Environments\n\n| dev | dev | https://x.example.com |\n")).toEqual(
      { kind: "named", branch: "dev" },
    );
  });

  it("prose without any branch pattern is a convention too", () => {
    const md = "## Environments\n\n| dev | der jeweils aktuelle Arbeits-Branch | - |\n";
    expect(devBranchFrom(md)).toEqual({ kind: "current" });
  });

  it("names the file the convention is read from", () => {
    expect(DEVOPS_FILE).toBe("delivery/devops.md");
  });
});

describe("isBranchName (req-020)", () => {
  it("accepts what git can check out", () => {
    for (const ok of ["dev", "main", "feature/x", "release-2026.07", "v2"]) {
      expect(isBranchName(ok)).toBe(true);
    }
  });

  it("rejects patterns and prose — those are conventions, not branches", () => {
    for (const no of ["feature/*", "aktueller Branch", "", "-dev", "a..b", "dev/"]) {
      expect(isBranchName(no)).toBe(false);
    }
  });
});

describe("environmentRow (req-020)", () => {
  it("hands the row over undecorated and raw, so both readers can use it", () => {
    const row = environmentRow(CONVENTION, "dev");
    expect(row?.header).toEqual(["Environment", "Branch", "URL"]);
    expect(row?.cells[1]).toBe("aktueller feature/*-Branch"); // backticks stripped
    expect(row?.raw[1]).toContain("`feature/*`"); // …but still there in the raw cell
  });

  it("finds no row where there is none", () => {
    expect(environmentRow(STANDARD, "staging")).toBeNull();
  });
});
