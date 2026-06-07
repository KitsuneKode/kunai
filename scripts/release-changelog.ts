// Shared changelog parsing helpers for release-guard and sync-root-changelog.

export interface ChangelogEntry {
  version: string;
  body: string;
}

export function compareSemver(a: string, b: string): number {
  const parsePart = (value: string | undefined): number => Number.parseInt(value ?? "0", 10);
  const [aMaj, aMin, aPat] = a.split(".");
  const [bMaj, bMin, bPat] = b.split(".");
  const a0 = parsePart(aMaj);
  const a1 = parsePart(aMin);
  const a2 = parsePart(aPat);
  const b0 = parsePart(bMaj);
  const b1 = parsePart(bMin);
  const b2 = parsePart(bPat);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}

export function highestChangelogVersion(content: string, prefix: "## " | "## v"): string | null {
  const re = new RegExp(`^${prefix === "## v" ? "## v" : "## "}(\\d+\\.\\d+\\.\\d+)\\s*$`, "gm");
  let highest: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const v = m[1];
    if (!v) continue;
    if (highest === null || compareSemver(v, highest) > 0) {
      highest = v;
    }
  }
  return highest;
}

function sliceChangelogSection(content: string, header: string): string | null {
  const headerRe = new RegExp(`^## ${header.replace(/\./g, "\\.")}\\s*$`, "m");
  const match = headerRe.exec(content);
  if (!match || match.index === undefined) return null;

  const bodyStart = match.index + match[0].length;
  const nextHeader = /\n## (?:v)?\d+\.\d+\.\d+\s*$/m.exec(content.slice(bodyStart));
  const bodyEnd = nextHeader ? bodyStart + nextHeader.index : content.length;
  return content.slice(bodyStart, bodyEnd).trim();
}

/** Parses the top `## X.Y.Z` entry from a per-package changelog. */
export function parseTopCliChangelogEntry(content: string): ChangelogEntry | null {
  const headerRe = /^## (\d+\.\d+\.\d+)\s*$/m;
  const match = headerRe.exec(content);
  if (!match?.[1]) return null;

  const rawBody = sliceChangelogSection(content, match[1]);
  if (rawBody === null) return null;

  let raw = rawBody.trim();
  raw = raw.replace(/^### Patch Changes\s*\n+/, "");
  const blank = raw.indexOf("\n\n");
  const indentedBody = blank >= 0 ? raw.slice(blank + 2) : "";
  const unindented = unindent(indentedBody);
  const body = `${match[1]} — ${firstLineSummary(raw)}\n\n${unindented}`.trim();
  return { version: match[1], body };
}

/** Parses a specific `## vX.Y.Z` entry from the root changelog (if present). */
export function parseRootChangelogEntry(content: string, rootKey: string): ChangelogEntry | null {
  const rawBody = sliceChangelogSection(content, rootKey);
  if (rawBody === null) return null;
  return { version: rootKey.replace(/^v/, ""), body: rawBody.trim() };
}

function firstLineSummary(raw: string): string {
  const firstLine = raw.split("\n", 1)[0] ?? "";
  let s = firstLine.replace(/^- /, "");
  const thanksIdx = s.indexOf("Thanks ");
  if (thanksIdx >= 0) {
    const bangIdx = s.indexOf("! - ", thanksIdx);
    if (bangIdx >= 0) {
      s = s.slice(bangIdx + 4);
    }
  }
  return s.trim();
}

function unindent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}
