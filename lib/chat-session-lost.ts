// Detects when Claude no longer knows the session chat-session-manager asked
// it to --resume (bug-029). The chat's working copy lives under
// CHAT_WORK_ROOT (chat-workspace.ts), and a container restart empties it —
// the next --resume then points at a session Claude can no longer find.
// Matching on the CLI's own wording, rather than on that one cause, also
// protects against any OTHER reason a session could disappear.
//
// Kept pure and text-only so it is trivially testable and has no I/O.

const SESSION_NOT_FOUND_PATTERN = /no conversation found with session/i;

/** Is this failure text Claude saying it no longer knows the --resume'd session? */
export function isSessionNotFound(text: string | null | undefined): boolean {
  if (!text) return false;
  return SESSION_NOT_FOUND_PATTERN.test(text);
}
