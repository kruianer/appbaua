import { describe, it, expect } from "vitest";
import { parseChatContentBlocks } from "./chat-message-blocks";

describe("parseChatContentBlocks (bug-031)", () => {
  it("returns a single text block for plain content", () => {
    expect(parseChatContentBlocks("Abgebrochen.")).toEqual([
      { type: "text", text: "Abgebrochen." },
    ]);
  });

  it("splits text before/after a code block into its own command block", () => {
    const content = "Anmeldung abgelaufen. Im Worker neu anmelden:\n\n```\ndocker exec -it appbaua-dev-worker-1 claude login\n```";
    expect(parseChatContentBlocks(content)).toEqual([
      { type: "text", text: "Anmeldung abgelaufen. Im Worker neu anmelden:" },
      { type: "command", command: "docker exec -it appbaua-dev-worker-1 claude login" },
    ]);
  });

  it("keeps several commands as separate fields, one per code block", () => {
    const content = "Schritt 1:\n\n```\nfirst command\n```\n\nSchritt 2:\n\n```\nsecond command\n```";
    expect(parseChatContentBlocks(content)).toEqual([
      { type: "text", text: "Schritt 1:" },
      { type: "command", command: "first command" },
      { type: "text", text: "Schritt 2:" },
      { type: "command", command: "second command" },
    ]);
  });

  it("returns an empty array for empty content", () => {
    expect(parseChatContentBlocks("")).toEqual([]);
  });
});
