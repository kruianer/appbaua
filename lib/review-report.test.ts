import { describe, it, expect } from "vitest";
import {
  REPORT_DIR,
  isoDate,
  reportContent,
  reportFileName,
  reportPath,
  slugify,
} from "./review-report";

// req-010: a recurring analysis task files its report in the repo. The filename
// alone has to say type, date and reference (repo/commit).

const now = new Date(2026, 6, 25, 3, 30, 0);

describe("slugify", () => {
  it("lowercases and joins everything non-alphanumeric with a dash", () => {
    expect(slugify("Code-Review")).toBe("code-review");
    expect(slugify("Security Review!")).toBe("security-review");
  });

  it("cannot produce path separators, so a stray id stays inside the folder", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
  });

  it("is empty when there is nothing usable left", () => {
    expect(slugify("???")).toBe("");
  });
});

describe("isoDate", () => {
  it("pads month and day", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("reportFileName (AC: type, date and reference are visible)", () => {
  const ref = {
    taskId: "code-review",
    repoName: "appbaua",
    commit: "282a765",
    now,
  };

  it("names date, type, repo and commit", () => {
    expect(reportFileName(ref)).toBe(
      "2026-07-25-code-review-appbaua-282a765.md",
    );
  });

  it("starts with the date, so a folder listing sorts oldest first", () => {
    const older = reportFileName({ ...ref, now: new Date(2026, 5, 1) });
    expect([reportFileName(ref), older].sort()[0]).toBe(older);
  });

  it("leaves the commit out when it could not be determined", () => {
    expect(reportFileName({ ...ref, commit: null })).toBe(
      "2026-07-25-code-review-appbaua.md",
    );
  });

  it("keeps unusual ids and repo names filename-safe", () => {
    expect(
      reportFileName({ ...ref, taskId: "Doku", repoName: "kruianer/app baua" }),
    ).toBe("2026-07-25-doku-kruianer-app-baua-282a765.md");
  });

  it("falls back to a placeholder when a value slugifies to nothing", () => {
    expect(reportFileName({ ...ref, taskId: "???", repoName: "..." })).toBe(
      "2026-07-25-task-repo-282a765.md",
    );
  });
});

describe("reportPath", () => {
  it("puts the report into the fixed reviews folder", () => {
    expect(REPORT_DIR).toBe("delivery/reviews");
    expect(
      reportPath({
        taskId: "doku",
        repoName: "appbaua",
        commit: "abc1234",
        now,
      }),
    ).toBe("delivery/reviews/2026-07-25-doku-appbaua-abc1234.md");
  });

  // req-014: the Security task keeps the naming rules but its own folder.
  it("puts the report into a given folder instead", () => {
    expect(
      reportPath(
        { taskId: "security", repoName: "appbaua", commit: "abc1234", now },
        "delivery/security",
      ),
    ).toBe("delivery/security/2026-07-25-security-appbaua-abc1234.md");
  });
});

describe("reportContent (AC: the FULL report lands in the file)", () => {
  const doc = {
    taskId: "code-review",
    taskLabel: "Code-Review",
    repoName: "appbaua",
    commit: "282a765",
    now,
    report: "## Befund 1\n\nEine sehr lange Analyse …",
  };

  it("keeps Claude's report verbatim", () => {
    expect(reportContent(doc)).toContain("## Befund 1\n\nEine sehr lange Analyse …");
  });

  it("carries type, repo, commit and date as front matter", () => {
    const md = reportContent(doc);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("type: code-review");
    expect(md).toContain("repo: appbaua");
    expect(md).toContain("commit: 282a765");
    expect(md).toContain("date: 2026-07-25");
  });

  it("has a readable heading naming type, repo and commit", () => {
    expect(reportContent(doc)).toContain("# Code-Review: appbaua (282a765)");
  });

  it("says 'unbekannt' instead of leaving the commit empty", () => {
    expect(reportContent({ ...doc, commit: null })).toContain(
      "commit: unbekannt",
    );
  });

  it("ends with exactly one trailing newline", () => {
    expect(reportContent(doc).endsWith("Analyse …\n")).toBe(true);
  });
});
