import { describe, it, expect } from "vitest";
import {
  SECURITY_OK_MESSAGE,
  SECURITY_POLICY_FILE,
  SECURITY_REPORT_DIR,
  hasSecurityFindings,
} from "./security-report";
import { reportPath } from "./review-report";

// req-014: the Security task files its report in its own folder — and only
// when the check found something.

describe("security folders", () => {
  it("reports go into delivery/security/, the policy is delivery/security.md", () => {
    expect(SECURITY_REPORT_DIR).toBe("delivery/security");
    expect(SECURITY_POLICY_FILE).toBe("delivery/security.md");
  });

  it("AC: the filename names type, date and repo", () => {
    expect(
      reportPath(
        {
          taskId: "security",
          repoName: "appbaua",
          commit: "282a765",
          now: new Date(2026, 6, 26, 3, 30),
        },
        SECURITY_REPORT_DIR,
      ),
    ).toBe("delivery/security/2026-07-26-security-appbaua-282a765.md");
  });
});

describe("hasSecurityFindings", () => {
  it("AC: the agreed all-clear answer is not a finding", () => {
    expect(hasSecurityFindings(SECURITY_OK_MESSAGE)).toBe(false);
  });

  it("ignores whitespace, case and markdown around the all-clear", () => {
    expect(hasSecurityFindings("  Security-Check ok\n")).toBe(false);
    expect(hasSecurityFindings("**Security-Check ok.**")).toBe(false);
    expect(hasSecurityFindings("security check OK")).toBe(false);
  });

  it("an empty answer is nothing to file either", () => {
    expect(hasSecurityFindings("")).toBe(false);
    expect(hasSecurityFindings("   \n  ")).toBe(false);
  });

  it("a report is a finding", () => {
    expect(
      hasSecurityFindings(
        "## Zusammenfassung\n\n### Finding 1 (hoch)\n\nToken im Repo.",
      ),
    ).toBe(true);
  });

  it("the all-clear with anything added to it counts as a finding", () => {
    // Better a report too many than a finding silently dropped.
    expect(hasSecurityFindings("Security-Check ok, aber: Port 80 offen.")).toBe(
      true,
    );
  });
});
