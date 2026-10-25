const ELLIPSIS = "…";

// Terminal-unsafe text cannot be column-counted and must not reach the tty:
// CSI/OSC escape sequences, C0/C1 controls, and bidi/BOM format controls.
// Provider-supplied strings (failureReason, pickerHint) flow through the
// truncation helpers, so the strip lives at the display boundary.
/* eslint-disable no-control-regex */
// The OSC body excludes ESC so a run of unterminated `ESC ]` introducers cannot
// make every match attempt rescan to the end of the string.
const ANSI_SEQUENCE =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const UNSAFE_CHAR = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */

export function sanitizeTerminalText(value: string): string {
  return value.replace(ANSI_SEQUENCE, "").replace(UNSAFE_CHAR, "");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function measureColumns(value: string): number {
  return Bun.stringWidth(sanitizeTerminalText(value));
}

/** Take complete user-visible characters within a terminal-cell budget. */
function takeColumns(clean: string, budget: number): string {
  let columns = 0;
  let output = "";
  for (const { segment } of graphemes.segment(clean)) {
    const width = Bun.stringWidth(segment);
    if (columns + width > budget) break;
    output += segment;
    columns += width;
  }
  return output;
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

  return `${takeColumns(clean, maxLength - 1)}${ELLIPSIS}`;
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

  const output = takeColumns(clean, maxLength - 1);

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
