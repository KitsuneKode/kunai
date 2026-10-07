const ELLIPSIS = "…";

// Terminal-unsafe text cannot be column-counted and must not reach the tty:
// CSI/OSC escape sequences, C0/C1 controls, and bidi/BOM format controls.
// Provider-supplied strings (failureReason, pickerHint) flow through the
// truncation helpers, so the strip lives at the display boundary.
/* eslint-disable no-control-regex */
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*\u0007|[@-Z\\-_])/g;
const UNSAFE_CHAR = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */

export function sanitizeTerminalText(value: string): string {
  return value.replace(ANSI_SEQUENCE, "").replace(UNSAFE_CHAR, "");
}

function isCombiningMark(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff))
  );
}

function charColumns(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (isCombiningMark(codePoint)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

export function measureColumns(value: string): number {
  let columns = 0;
  for (const char of sanitizeTerminalText(value)) {
    columns += charColumns(char);
  }
  return columns;
}

export function padColumnsEnd(value: string, targetColumns: number): string {
  const clean = sanitizeTerminalText(value);
  return `${clean}${" ".repeat(Math.max(0, targetColumns - measureColumns(clean)))}`;
}

export function padColumnsStart(value: string, targetColumns: number): string {
  const clean = sanitizeTerminalText(value);
  return `${" ".repeat(Math.max(0, targetColumns - measureColumns(clean)))}${clean}`;
}

export function truncateLine(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const clean = sanitizeTerminalText(value);
  if (measureColumns(clean) <= maxLength) return clean;
  if (maxLength <= 1) return ELLIPSIS;

  const budget = maxLength - 1;
  let columns = 0;
  let output = "";

  for (const char of clean) {
    const width = charColumns(char);
    if (columns + width > budget) break;
    output += char;
    columns += width;
  }

  return `${output}${ELLIPSIS}`;
}

const PLACEHOLDER_EPISODE_NAME = /^(?:tba|untitled|n\/a|none)$/i;

/** True when TMDB/provider gave no real episode title. */
export function isPlaceholderEpisodeName(episodeNumber: number, name: string | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return true;
  if (PLACEHOLDER_EPISODE_NAME.test(trimmed)) return true;
  if (/^[\s.\-_·…,;:]+$/.test(trimmed)) return true;
  return trimmed.toLowerCase() === `episode ${episodeNumber}`;
}

export function dedupeEpisodeLabel(episodeNumber: number, name: string | undefined): string {
  if (isPlaceholderEpisodeName(episodeNumber, name)) {
    return `Episode ${episodeNumber}`;
  }
  return `Episode ${episodeNumber}  ·  ${name?.trim() ?? ""}`;
}

export function truncateAtWord(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const clean = sanitizeTerminalText(value);
  if (measureColumns(clean) <= maxLength) return clean;
  if (maxLength <= 1) return ELLIPSIS;

  // The budget is in terminal columns, so the cut must walk columns too:
  // `value.slice(0, budget)` counts UTF-16 code units, which lets CJK emit up
  // to twice the budget's width and can split a surrogate pair mid-character.
  const budget = maxLength - 1;
  let columns = 0;
  let output = "";
  for (const char of clean) {
    const width = charColumns(char);
    if (columns + width > budget) break;
    output += char;
    columns += width;
  }

  // Stopped exactly at a word boundary — nothing to back off to.
  if (clean[output.length] === " ") return `${output.trimEnd()}${ELLIPSIS}`;
  const lastSpace = output.lastIndexOf(" ");
  if (lastSpace <= 0) return truncateLine(value, maxLength);
  return `${output.slice(0, lastSpace)}${ELLIPSIS}`;
}

export function wrapText(value: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return [];

  const words = sanitizeTerminalText(value).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measureColumns(candidate) <= width) {
      current = candidate;
      continue;
    }

    if (current.length > 0) lines.push(current);
    if (lines.length === maxLines) {
      lines[maxLines - 1] = truncateLine(lines[maxLines - 1] ?? "", width);
      return lines;
    }
    current = word;
  }

  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
  }

  return lines
    .slice(0, maxLines)
    .map((line, index, all) => (index === all.length - 1 ? truncateLine(line, width) : line));
}

export function getWindowStart(selectedIndex: number, total: number, windowSize: number): number {
  if (total <= windowSize) return 0;

  const halfWindow = Math.floor(windowSize / 2);
  let start = selectedIndex - halfWindow;
  if (start < 0) start = 0;
  if (start + windowSize > total) start = total - windowSize;
  return start;
}

/** "1 result", "3 results" — a count with the noun it agrees with. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
