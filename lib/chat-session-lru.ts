// req-040 constraint: "Es laufen höchstens fünf Claude-Sitzungen gleichzeitig.
// Wird eine sechste gebraucht, wird die am längsten unbenutzte beendet; ihr
// Gesprächstext bleibt erhalten." Pure, I/O-free LRU bookkeeping — the
// conversation itself lives entirely in the persisted store (chat-session-
// store.ts) and is never touched here, so "beendet" only ever means dropped
// from this in-memory set of repos whose session currently counts as active.

export const MAX_ACTIVE_SESSIONS = 5;

/**
 * Mark `repoId`'s session as just used: moves it to the most-recent end of
 * `active` (oldest first), adding it if it was not there. If that pushes the
 * set past {@link MAX_ACTIVE_SESSIONS}, the least-recently-used entry is
 * evicted and returned — never `repoId` itself, since it was just touched.
 */
export function touchActiveSession(
  active: string[],
  repoId: string,
): { active: string[]; evicted: string | null } {
  const withoutRepo = active.filter((id) => id !== repoId);
  const next = [...withoutRepo, repoId];
  if (next.length <= MAX_ACTIVE_SESSIONS) {
    return { active: next, evicted: null };
  }
  const [evicted, ...rest] = next;
  return { active: rest, evicted };
}
