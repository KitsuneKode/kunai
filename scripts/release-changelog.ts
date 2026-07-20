// Shared changelog parsing helpers for release-guard and sync-root-changelog.

export interface ChangelogEntry {
  version: string;
  body: string;
}

export type ChangelogChangeKind = "major" | "minor" | "patch";
export interface ChangelogChange {
  readonly kind: ChangelogChangeKind;
  readonly body: string;
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sliceChangelogSection(content: string, header: string): string | null {
  const headerRe = new RegExp(`^## ${escapeRegex(header)}\\s*$`, "m");
  const match = headerRe.exec(content);
  if (!match || match.index === undefined) return null;

  const bodyStart = match.index + match[0].length;
  const nextHeader = /\n## (?:v)?\d+\.\d+\.\d+\s*$/m.exec(content.slice(bodyStart));
  const bodyEnd = nextHeader ? bodyStart + nextHeader.index : content.length;
  return content.slice(bodyStart, bodyEnd).trim();
}

const CHANGESET_GROUPS: readonly {
  readonly kind: ChangelogChangeKind;
  readonly heading: string;
}[] = [
  { kind: "major", heading: "Major Changes" },
  { kind: "minor", heading: "Minor Changes" },
  { kind: "patch", heading: "Patch Changes" },
];

/**
 * Parses a rendered changeset body (the block below a `## X.Y.Z` heading) into
 * ordered, kind-tagged entries. Recognizes the `### Major/Minor/Patch Changes`
 * group wrappers, splits the top-level `- ` entries within each group, and
 * cleans each entry: attribution prefixes (commit links, `sha:` ids, and
 * `Thanks @user! -` credits), HTML comments, and one level of changeset
 * indentation are removed, while nested prose and sub-headings survive.
 */
export function parseChangesetEntries(rawBody: string): readonly ChangelogChange[] {
  const cleaned = stripHtmlComments(rawBody);
  const changes: ChangelogChange[] = [];
  for (const { kind, heading } of CHANGESET_GROUPS) {
    const group = sliceChangesetGroup(cleaned, heading);
    if (group === null) continue;
    for (const block of splitChangesetEntries(group)) {
      const body = renderChangesetEntry(block);
      if (body) changes.push({ kind, body });
    }
  }
  return changes;
}

/** Parses the top `## X.Y.Z` entry from a per-package changelog. */
export function parseTopCliChangelogEntry(content: string): ChangelogEntry | null {
  const headerRe = /^## (\d+\.\d+\.\d+)\s*$/m;
  const match = headerRe.exec(content);
  if (!match?.[1]) return null;

  const rawBody = sliceChangelogSection(content, match[1]);
  if (rawBody === null) return null;

  const changes = parseChangesetEntries(rawBody);
  const body =
    changes.length > 0
      ? changes
          .map((change) => change.body)
          .join("\n\n")
          .trim()
      : stripHtmlComments(rawBody).trim();
  return { version: match[1], body };
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/** Extracts the content of a single `### <heading>` group up to the next `### ` heading. */
function sliceChangesetGroup(content: string, heading: string): string | null {
  const headingRe = new RegExp(`^### ${escapeRegex(heading)}\\s*$`, "m");
  const match = headingRe.exec(content);
  if (!match || match.index === undefined) return null;

  const rest = content.slice(match.index + match[0].length);
  const nextHeading = /^### .+$/m.exec(rest);
  const end = nextHeading?.index ?? rest.length;
  return rest.slice(0, end).trim();
}

/**
 * Splits a group's body into blocks. Each top-level `- ` bullet starts a new
 * block; any prose before the first bullet becomes a leading block so nothing
 * is dropped.
 */
function splitChangesetEntries(group: string): readonly string[] {
  const preamble: string[] = [];
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of group.split("\n")) {
    if (line.startsWith("- ")) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) blocks.push(current.join("\n"));

  const lead = preamble.join("\n").trim();
  return lead ? [lead, ...blocks] : blocks;
}

/** Cleans a single entry block: strip the bullet + attribution, de-indent, promote headings. */
function renderChangesetEntry(block: string): string {
  const lines = block.split("\n").map((line, index) => {
    if (index === 0 && line.startsWith("- ")) {
      return cleanEntrySummary(line.slice(2));
    }
    return line.startsWith("  ") ? line.slice(2) : line;
  });
  return promoteNestedHeadings(lines.join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")
    .trimEnd();
}

/** Removes changeset attribution from an entry's summary line. */
function cleanEntrySummary(summary: string): string {
  let s = summary.replace(/^\[[^\]]*\]\([^)]*\)\s*/, "");
  if (s.startsWith("Thanks ")) {
    const bangIdx = s.indexOf("! - ");
    if (bangIdx >= 0) s = s.slice(bangIdx + 4);
  }
  s = s.replace(/^[0-9a-f]{6,40}:\s+/i, "");
  return s.trim();
}

/**
 * Promotes nested changeset headings up one level so they render as top-level
 * release-note sections, clamped so nothing rises above `###` (the section
 * level). A nested `#### Highlights` becomes `### Highlights`; an existing
 * `### Highlights` is left untouched.
 */
function promoteNestedHeadings(text: string): string {
  return text.replace(/^(#{3,6})(\s)/gm, (_match, hashes: string, space: string) => {
    return "#".repeat(Math.max(3, hashes.length - 1)) + space;
  });
}

/** Parses a specific `## vX.Y.Z` entry from the root changelog (if present). */
export function parseRootChangelogEntry(content: string, rootKey: string): ChangelogEntry | null {
  const rawBody = sliceChangelogSection(content, rootKey);
  if (rawBody === null) return null;
  return { version: rootKey.replace(/^v/, ""), body: rawBody.trim() };
}
