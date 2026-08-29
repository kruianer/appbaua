import { describe, it, expect } from "vitest";
import {
  deriveName,
  isDuplicate,
  looksLikeRepoUrl,
  normalizeUrl,
  type Repo,
} from "./repos";

describe("normalizeUrl", () => {
  it("strips protocol and .git suffix", () => {
    expect(normalizeUrl("https://github.com/kruianer/appbaua.git")).toBe(
      "github.com/kruianer/appbaua",
    );
  });

  it("treats http/https/www and trailing slash as the same repo", () => {
    const a = normalizeUrl("https://www.github.com/kruianer/appbaua/");
    const b = normalizeUrl("http://github.com/kruianer/appbaua");
    expect(a).toBe(b);
  });

  it("normalizes ssh (git@) form to the same key", () => {
    expect(normalizeUrl("git@github.com:kruianer/appbaua.git")).toBe(
      "github.com/kruianer/appbaua",
    );
  });
});

describe("deriveName", () => {
  it("uses the last path segment", () => {
    expect(deriveName("github.com/kruianer/appbaua")).toBe("appbaua");
  });
});

describe("looksLikeRepoUrl", () => {
  it("accepts a github owner/repo url", () => {
    expect(looksLikeRepoUrl("https://github.com/kruianer/appbaua.git")).toBe(
      true,
    );
  });
  it("rejects garbage", () => {
    expect(looksLikeRepoUrl("not a url")).toBe(false);
  });
});

describe("isDuplicate", () => {
  const repos: Repo[] = [
    { id: "1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true, model: "sonnet", monitored: false },
  ];
  it("detects an existing normalized url", () => {
    expect(isDuplicate(repos, "github.com/kruianer/appbaua")).toBe(true);
  });
  it("is false for a new url", () => {
    expect(isDuplicate(repos, "github.com/kruianer/other")).toBe(false);
  });
});
