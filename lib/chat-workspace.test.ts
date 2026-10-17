import { describe, it, expect, vi } from "vitest";
import { repoDir } from "./workspace";
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
});
