// Zerlegt eine Chat-Nachricht in Text- und Befehlsabschnitte (bug-031): ein
// Fehler wie die abgelaufene Anmeldung (lib/auth-expired.ts) liefert seinen
// Befehl in einem Markdown-Codeblock mit, den die Oberfläche als eigenes
// Kopierfeld zeigen soll statt als Fließtext. Mehrere Blöcke (mehrere nötige
// Schritte) werden zu mehreren Feldern — jeder Block einzeln, in der
// Reihenfolge, in der er im Text steht.
//
// Pure und ohne DOM, damit die Aufteilung unabhängig von der React-Komponente
// testbar ist.

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "command"; command: string };

const CODE_BLOCK = /```[^\n`]*\n?([\s\S]*?)```/g;

export function parseChatContentBlocks(content: string): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(CODE_BLOCK)) {
    const before = content.slice(lastIndex, match.index).trim();
    if (before) blocks.push({ type: "text", text: before });
    blocks.push({ type: "command", command: match[1].trim() });
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  const rest = content.slice(lastIndex).trim();
  if (rest) blocks.push({ type: "text", text: rest });
  return blocks;
}
