import { describe, it, expect } from "vitest";
import {
  DOC_SITE_FILE,
  DOC_UNCHANGED_MESSAGE,
  DONE_REQUIREMENTS_DIR,
  NO_DESIGN_MESSAGE,
  SITE_ROOT,
  USER_DOCS_DIR,
  designDirFrom,
} from "./doc-site";

// req-016: the Doku task reads WHERE its design template lies out of the repo's
// own delivery/doc-site.md. That pointer decides whether the task runs at all,
// so every way of getting "no template" out of that file is pinned here.

/** The file the setup-doc-site skill writes, with the template location filled in. */
const DOC_SITE = [
  "---",
  "project: appbaua",
  "---",
  "",
  "# Doku-Site-Vorgaben",
  "",
  "Bindende Vorgabe für den Doku-Task des autonomen Workers (req-016).",
  "",
  "## Design-Vorlage",
  "",
  "- Ort: delivery/doc-design/",
  "- Bestandteile: HTML/CSS-Vorlage + Handover-Markdown",
  "- Bindung: Orientierung — der Worker hält sich so weit wie möglich an",
  "  die Vorlage, hat aber Freiheiten.",
  "",
  "## Ausgabe im Repo",
  "",
  "- Doku-Ordner: site/user-docs/",
  "",
  "## Deploy-Ziele",
  "",
  "| Umgebung | Host/URL          | Auslöser            |",
  "|----------|-------------------|---------------------|",
  "| dev      | doku.beelink.lan  | Push auf dev        |",
  "| prod     | doku.appbaua.com  | nur über Human-Gate |",
].join("\n");

describe("doc-site folders", () => {
  it("the docs live under the shared web root, the spec in delivery/", () => {
    expect(SITE_ROOT).toBe("site");
    expect(USER_DOCS_DIR).toBe("site/user-docs");
    expect(DOC_SITE_FILE).toBe("delivery/doc-site.md");
    expect(DONE_REQUIREMENTS_DIR).toBe("delivery/requirements/done");
  });

  it("has the two fixed log messages of the task", () => {
    expect(NO_DESIGN_MESSAGE).toBe("keine Design-Vorgabe hinterlegt");
    expect(DOC_UNCHANGED_MESSAGE).toBe("Doku unverändert");
  });
});

describe("designDirFrom", () => {
  it("AC: reads the template location out of the doc-site spec", () => {
    expect(designDirFrom(DOC_SITE)).toBe("delivery/doc-design");
  });

  it("no doc-site.md at all -> no template", () => {
    expect(designDirFrom(null)).toBeNull();
    expect(designDirFrom(undefined)).toBeNull();
    expect(designDirFrom("")).toBeNull();
  });

  it("AC: an unfilled template placeholder is NOT a location", () => {
    // What setup-doc-site's own template literally contains. Treating it as a
    // path would send the Doku task at a folder called "<Ordnerpfad, …>".
    const unfilled = DOC_SITE.replace(
      "- Ort: delivery/doc-design/",
      "- Ort: <Ordnerpfad, z.B. delivery/doc-design/>",
    );
    expect(designDirFrom(unfilled)).toBeNull();
  });

  it("a spec without a Design-Vorlage section names no template", () => {
    expect(
      designDirFrom("# Doku-Site-Vorgaben\n\n## Deploy-Ziele\n\n- dev: beelink\n"),
    ).toBeNull();
  });

  it("only the Design-Vorlage section is read, never the deploy hosts", () => {
    // Without the section boundary, "site/user-docs" from the next section would
    // pass for the design template.
    const noPath = DOC_SITE.replace(
      "- Ort: delivery/doc-design/",
      "- Ort: noch nicht festgelegt",
    );
    expect(designDirFrom(noPath)).toBeNull();
  });

  it("survives a translated or missing bullet label — only the value is a path", () => {
    const head = "## Design-Vorlage\n\n";
    expect(designDirFrom(`${head}- Location: docs/design\n`)).toBe("docs/design");
    expect(designDirFrom(`${head}- docs/design/\n`)).toBe("docs/design");
    expect(designDirFrom(`${head}* Ort: docs/design\n`)).toBe("docs/design");
  });

  it("strips the decoration a hand-written line carries", () => {
    const head = "## Design-Vorlage\n\n";
    expect(designDirFrom(`${head}- Ort: \`delivery/doc-design/\`\n`)).toBe(
      "delivery/doc-design",
    );
    expect(
      designDirFrom(`${head}- Ort: [doc-design](delivery/doc-design/)\n`),
    ).toBe("delivery/doc-design");
    expect(designDirFrom(`${head}- Ort: delivery/doc-design.\n`)).toBe(
      "delivery/doc-design",
    );
  });

  it("skips prose bullets and takes the first that really is a path", () => {
    const md = [
      "## Design-Vorlage",
      "",
      "- Bestandteile: HTML/CSS-Vorlage + Handover-Markdown",
      "- Ort: delivery/doc-design/",
    ].join("\n");
    expect(designDirFrom(md)).toBe("delivery/doc-design");
  });

  it("refuses to leave the working copy", () => {
    const head = "## Design-Vorlage\n\n";
    expect(designDirFrom(`${head}- Ort: /etc/design\n`)).toBeNull();
    expect(designDirFrom(`${head}- Ort: ../../anderes-repo/design\n`)).toBeNull();
    expect(
      designDirFrom(`${head}- Ort: https://example.com/design\n`),
    ).toBeNull();
  });

  it("finds the section under any heading level and wording", () => {
    expect(designDirFrom("### Design-Vorlage\n- Ort: a/b\n")).toBe("a/b");
    expect(designDirFrom("## 1. Design-Vorlage (Quelle)\n- Ort: a/b\n")).toBe("a/b");
  });
});
