/** Keystroke vocabulary shared by both driver layers and `agent:drive`. */
export const K = {
  enter: "\r",
  esc: "\x1b",
  tab: "\t",
  space: " ",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  ctrlC: "\x03",
} as const;

/** Human-readable form for transcripts: `enter`, `esc`, or the literal text. */
export function keyLabel(key: string): string {
  for (const [name, value] of Object.entries(K)) {
    if (value === key) return `<${name}>`;
  }
  if (key.length > 1 && !key.startsWith("\x1b")) return `"${key}"`;
  return JSON.stringify(key);
}
