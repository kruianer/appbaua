import { describe, it, expect, vi } from "vitest";
import { listGithubRepos, mapGithubRepos } from "./github-repos";

describe("mapGithubRepos", () => {
  it("normalizes to github.com/owner/repo (lowercase), sorted", () => {
    const out = mapGithubRepos([
      { full_name: "kruianer/Zebra" },
      { full_name: "kruianer/appbaua" },
    ]);
    expect(out).toEqual([
      { fullName: "kruianer/appbaua", url: "github.com/kruianer/appbaua" },
      { fullName: "kruianer/Zebra", url: "github.com/kruianer/zebra" },
    ]);
  });

  it("drops archived repos", () => {
    const out = mapGithubRepos([
      { full_name: "kruianer/old", archived: true },
      { full_name: "kruianer/live" },
    ]);
    expect(out.map((r) => r.fullName)).toEqual(["kruianer/live"]);
  });
});

describe("listGithubRepos", () => {
  it("returns [] with no token", async () => {
    expect(await listGithubRepos({ token: "" })).toEqual([]);
  });

  it("fetches with the token and maps the result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ full_name: "kruianer/appbaua" }],
      });
    const out = await listGithubRepos({
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual([
      { fullName: "kruianer/appbaua", url: "github.com/kruianer/appbaua" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("api.github.com/user/repos"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer t" }),
      }),
    );
  });
});
