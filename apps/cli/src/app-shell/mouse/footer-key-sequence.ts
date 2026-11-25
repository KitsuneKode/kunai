/**
 * The keystroke a footer hint names, so clicking the hint can press it. Only
 * unambiguous spellings map: a single key, a named key, ⇧X, Ctrl+X, or the
 * first of `x / X`. Pairs like `↑↓`, words like `year`, and typed commands
 * like `/provider` stay display-only.
 */
const NAMED: Readonly<Record<string, string>> = {
  enter: "\r",
  "↵": "\r",
  return: "\r",
  esc: "\x1b",
  escape: "\x1b",
  tab: "\t",
  space: " ",
  "↑": "\x1b[A",
  "↓": "\x1b[B",
  "→": "\x1b[C",
  "←": "\x1b[D",
};

export function footerKeySequence(key: string): string | null {
  const first = key.split(" / ")[0]?.trim() ?? "";
  const named = NAMED[first.toLowerCase()] ?? NAMED[first];
  if (named) return named;
  const shifted = /^(?:⇧|shift\+)(.)$/i.exec(first);
  if (shifted?.[1]) return shifted[1].toUpperCase();
  const control = /^ctrl\+([a-z])$/i.exec(first);
  if (control?.[1]) return String.fromCharCode(control[1].toLowerCase().charCodeAt(0) - 96);
  return [...first].length === 1 ? first : null;
}
