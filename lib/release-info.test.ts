import { describe, it, expect } from "vitest";
import {
  RELEASE_INFO_DIR,
  RELEASE_INFO_MARKER,
  extractReleaseInfo,
  parseReleaseInfo,
  releaseInfoContent,
  releaseInfoFileName,
  releaseInfoPath,
} from "./release-info";

// req-046: Namenskonvention, Inhalt und Markerauswertung der Release-Info.

const now = new Date(2026, 9, 18, 10, 0, 0);
const ref = { repoName: "appbaua", packageId: "req-046-release-infos-je-paket", now };

describe("extractReleaseInfo", () => {
  it("liest den Text nach dem Marker", () => {
    const report = [
      "Alles abgehakt und committet.",
      "",
      `${RELEASE_INFO_MARKER}`,
      "Du kannst jetzt X tun. Y sieht jetzt anders aus.",
    ].join("\n");
    expect(extractReleaseInfo(report)).toBe(
      "Du kannst jetzt X tun. Y sieht jetzt anders aus.",
    );
  });

  it("gibt null zurück, wenn der Marker fehlt", () => {
    expect(extractReleaseInfo("Fertig. Alles grün.")).toBeNull();
  });

  it("gibt null zurück, wenn nach dem Marker nichts als Leerraum steht", () => {
    expect(extractReleaseInfo(`${RELEASE_INFO_MARKER}\n   \n`)).toBeNull();
  });

  it("nimmt nur das LETZTE Vorkommen des Markers", () => {
    const report = [
      `Der Text erwähnt ${RELEASE_INFO_MARKER} irgendwo mittendrin.`,
      `${RELEASE_INFO_MARKER}`,
      "Das ist der echte Text.",
    ].join("\n");
    expect(extractReleaseInfo(report)).toBe("Das ist der echte Text.");
  });
});

describe("releaseInfoFileName / releaseInfoPath", () => {
  it("benennt Datum und Paket-Id", () => {
    expect(releaseInfoFileName(ref)).toBe(
      "2026-10-18-req-046-release-infos-je-paket.md",
    );
  });

  it("liegt im festen Ordner", () => {
    expect(RELEASE_INFO_DIR).toBe("delivery/release-info");
    expect(releaseInfoPath(ref)).toBe(
      "delivery/release-info/2026-10-18-req-046-release-infos-je-paket.md",
    );
  });

  it("fällt auf einen Platzhalter zurück, wenn die Paket-Id zu nichts slugifiziert", () => {
    expect(releaseInfoFileName({ ...ref, packageId: "???" })).toBe(
      "2026-10-18-paket.md",
    );
  });
});

describe("releaseInfoContent / parseReleaseInfo", () => {
  const text = "Du kannst jetzt Wochenbudgets je Repo setzen.";

  it("schreibt Repo/Paket/Datum als Frontmatter, dann den Text", () => {
    const md = releaseInfoContent({ ...ref, text });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("repo: appbaua");
    expect(md).toContain("package: req-046-release-infos-je-paket");
    expect(md).toContain("date: 2026-10-18");
    expect(md).toContain(text);
  });

  it("lässt sich wieder einlesen", () => {
    const md = releaseInfoContent({ ...ref, text });
    expect(parseReleaseInfo(md)).toEqual({
      repoName: "appbaua",
      packageId: "req-046-release-infos-je-paket",
      date: "2026-10-18",
      text,
    });
  });

  it("gibt null zurück, wenn kein Frontmatter da ist", () => {
    expect(parseReleaseInfo("Nur Text, kein Frontmatter.")).toBeNull();
  });

  it("gibt null zurück, wenn ein Pflichtfeld fehlt", () => {
    expect(
      parseReleaseInfo("---\nrepo: appbaua\ndate: 2026-10-18\n---\nText"),
    ).toBeNull();
  });
});
