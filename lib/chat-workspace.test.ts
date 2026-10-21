import { describe, it, expect, vi } from "vitest";
import { ENV_CREDENTIAL_HELPER, repoDir } from "./workspace";
import { CHAT_WORK_ROOT, prepareChatRepo } from "./chat-workspace";
import type { Repo } from "./repos";

// req-040 AC15: eine Änderung aus dem Chat darf NICHT in der Arbeitskopie des
// Workers landen. Das ist nur garantiert, wenn Chat und Worker für dasselbe
// Repo auf unterschiedlichen Wurzeln klonen.

const repo: Repo = {
  id: "r1",
  name: "CellarVoice",
  url: "github.com/k/cellarvoice",
  active: true,
  model: "sonnet",
  monitored: false,
};

describe("Chat-Arbeitskopie (req-040 AC15)", () => {
  it("AC: der Chat-Wurzelordner unterscheidet sich vom Standard-Wurzelordner des Workers", () => {
    expect(repoDir(repo.url, CHAT_WORK_ROOT)).not.toBe(repoDir(repo.url));
  });

  it("AC: prepareChatRepo klont unter dem Chat-Wurzelordner, nicht dem des Workers", async () => {
    const runImpl = vi.fn(async () => ({
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    }));
    const readFileImpl = async () => null; // kein devops.md -> req-013-Fallback (dev existiert laut Mock)
    const result = await prepareChatRepo(repo, "token", { runImpl, readFileImpl });
    expect(result.dir).toBe(repoDir(repo.url, CHAT_WORK_ROOT));
    expect(result.dir).not.toBe(repoDir(repo.url));
  });
  // bug-040: Commits und Änderungen überleben die nächste Nachricht.
  it("bug-040: setzt die Arbeitskopie nicht zurück und räumt nichts weg", async () => {
    const calls: string[][] = [];
    const runImpl = vi.fn(async (_cmd: string, args: string[]) => {
      calls.push(args);
      const stdout = args[0] === "rev-parse" && args.includes("--abbrev-ref") ? "dev\n" : "";
      return { ok: true, code: 0, stdout, stderr: "" };
    });
    await prepareChatRepo(repo, "token", { runImpl, readFileImpl: async () => null });
    expect(calls.some((a) => a[0] === "reset")).toBe(false);
    expect(calls.some((a) => a[0] === "clean")).toBe(false);
    expect(calls.some((a) => a[0] === "checkout")).toBe(false);
  });

  it("bug-040: wechselt auf einen vorhandenen lokalen Zweig ohne -B", async () => {
    const calls: string[][] = [];
    const runImpl = vi.fn(async (_cmd: string, args: string[]) => {
      calls.push(args);
      const stdout = args[0] === "rev-parse" && args.includes("--abbrev-ref") ? "main\n" : "";
      return { ok: true, code: 0, stdout, stderr: "" };
    });
    await prepareChatRepo(repo, "token", { runImpl, readFileImpl: async () => null });
    const co = calls.find((a) => a[0] === "checkout");
    expect(co).toEqual(["checkout", "dev"]);
    expect(calls.some((a) => a[0] === "reset")).toBe(false);
  });

  // bug-041: ein normales git push/pull im Chat findet den Token selbst.
  it("bug-041: trägt einen Credential-Helper ein, der den Token aus der Umgebung liest", async () => {
    const configs: string[][] = [];
    const runImpl = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "config") configs.push(args);
      const stdout = args[0] === "rev-parse" && args.includes("--abbrev-ref") ? "dev\n" : "";
      return { ok: true, code: 0, stdout, stderr: "" };
    });
    await prepareChatRepo(repo, "geheim-123", { runImpl, readFileImpl: async () => null });
    const helper = configs.find((a) => a[1] === "credential.helper");
    expect(helper?.[2]).toBe(ENV_CREDENTIAL_HELPER);
    expect(helper?.[2]).toContain("$GITHUB_TOKEN");
    expect(configs.flat().join(" ")).not.toContain("geheim-123");
  });
});
