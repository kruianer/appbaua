import type { Repo } from "./repos";
import {
  type PrepareDeps,
  type PreparedRepo,
  prepareRepoOnConvention,
} from "./workspace";

// req-040 constraint: "Der Chat benutzt eine eigene Arbeitskopie je Repo,
// getrennt von der des Workers." Both clone the same target repo under the
// same scheme (repoDir: slugged URL under a root), so the only thing that
// has to differ is the root itself — CHAT_WORK_ROOT instead of the worker's
// WORKER_WORKDIR. Everything else (which branch to check out, how to
// authenticate) is identical, so this wraps prepareRepoOnConvention rather
// than duplicating it.

export const CHAT_WORK_ROOT = process.env.CHAT_WORKDIR || "/tmp/appbaua-chat";

export async function prepareChatRepo(
  repo: Repo,
  token: string,
  deps: PrepareDeps = {},
): Promise<PreparedRepo> {
  return prepareRepoOnConvention(repo.url, token, {
    ...deps,
    // bug-040: the chat keeps unpushed commits and edits between messages.
    keepLocalWork: true,
    root: deps.root ?? CHAT_WORK_ROOT,
  });
}
