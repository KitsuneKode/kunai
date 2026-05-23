const ELLIPSIS = "…";

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

export function measureColumns(value: string): number {
  let columns = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    if (isCombiningMark(codePoint)) continue;
    columns += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return columns;
}

export function padColumnsEnd(value: string, targetColumns: number): string {
  const padding = Math.max(0, targetColumns - measureColumns(value));
  return `${value}${" ".repeat(padding)}`;
}

export function padColumnsStart(value: string, targetColumns: number): string {
  const padding = Math.max(0, targetColumns - measureColumns(value));
  return `${" ".repeat(padding)}${value}`;
}

export function truncateLine(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (measureColumns(value) <= maxLength) return value;
  if (maxLength <= 1) return ELLIPSIS;

  const budget = maxLength - 1;
  let columns = 0;
  let output = "";

  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    const charColumns =
      codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)
        ? 0
        : isCombiningMark(codePoint)
          ? 0
          : isWideCodePoint(codePoint)
            ? 2
            : 1;
    if (columns + charColumns > budget) break;
    output += char;
    columns += charColumns;
  }

  return `${output}${ELLIPSIS}`;
}

export function truncateAtWord(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (measureColumns(value) <= maxLength) return value;
  if (maxLength <= 1) return ELLIPSIS;
  const budget = maxLength - 1; // room for the ellipsis
  const slice = value.slice(0, budget);
  // Boundary lands exactly between words → keep the whole slice.
  if (value[budget] === " ") return `${slice.trimEnd()}${ELLIPSIS}`;
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace <= 0) return truncateLine(value, maxLength); // first word too long → hard cut
  return `${slice.slice(0, lastSpace)}${ELLIPSIS}`;
}

export function wrapText(value: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return [];

  const words = value.trim().split(/\s+/).filter(Boolean);
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
