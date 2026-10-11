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

const NAMED_KEY_TOKENS: Record<string, string> = {
  enter: K.enter,
  esc: K.esc,
  escape: K.esc,
  tab: K.tab,
  space: K.space,
  backspace: K.backspace,
  up: K.up,
  down: K.down,
  left: K.left,
  right: K.right,
  ctrlc: K.ctrlC,
};

/**
 * Decode one CLI token into input bytes. `<name>` maps to the K vocabulary;
 * everything else is literal text with C-escapes decoded (`\r`, `\x1b`, `\e`,
 * `\t`, `\n`). Shared by `agent:drive` and `agent:session` so both drivers
 * accept the same spelling.
 */
export function decodeKeyToken(raw: string): string {
  const name = /^<([a-zA-Z]+)>$/.exec(raw)?.[1];
  if (name) {
    const key = NAMED_KEY_TOKENS[name.toLowerCase()];
    if (!key) throw new Error(`unknown key name <${name}>`);
    return key;
  }
  return raw
    .replace(/\\x1b|\\e/g, "\x1b")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n");
}
