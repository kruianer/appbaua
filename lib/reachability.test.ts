import { describe, it, expect, vi } from "vitest";
import { checkReachable, githubOwnerRepo } from "./reachability";

describe("githubOwnerRepo", () => {
  it("extracts owner/repo", () => {
    expect(githubOwnerRepo("github.com/kruianer/appbaua")).toBe(
      "kruianer/appbaua",
    );
  });
  it("returns null for non-github", () => {
    expect(githubOwnerRepo("gitlab.com/kruianer/appbaua")).toBeNull();
  });
});

describe("checkReachable", () => {
  it("fails with 'format' for a non-repo string", async () => {
    const r = await checkReachable("nonsense", { token: "t" });
    expect(r).toEqual({ ok: false, reason: "format" });
  });

  it("fails with 'no-token' when no token is configured", async () => {
    const r = await checkReachable("github.com/kruianer/appbaua", {
      token: "",
    });
    expect(r).toEqual({ ok: false, reason: "no-token" });
  });

  it("is ok when the API returns 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const r = await checkReachable("https://github.com/kruianer/appbaua.git", {
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/kruianer/appbaua",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer t",
        }),
      }),
    );
  });

  it("is unreachable when the API returns 404 (private, no access)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const r = await checkReachable("github.com/kruianer/secret", {
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toEqual({ ok: false, reason: "unreachable" });
  });
});
