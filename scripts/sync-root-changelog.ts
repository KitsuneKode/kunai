#!/usr/bin/env bun
// scripts/sync-root-changelog.ts
//
// Mirror the just-versioned entry from apps/cli/CHANGELOG.md to the repo-root
// CHANGELOG.md, prefixed with `v` (e.g. v0.2.5).
//
// Why this exists:
//   The root CHANGELOG.md is the user-facing, narrative release notes (Highlights /
//   Features / Fixes / Performance). The per-package apps/cli/CHANGELOG.md is the
//   canonical release artifact that ships with the npm package. The two were
//   drifting because the v0.2.5 release was hand-prepared and only the root was
//   updated. This script keeps them in lock-step automatically: `changeset version`
//   updates the per-package changelog; this script immediately mirrors that
//   new top entry to the root, un-indenting the github-plugin body so the
//   narrative reads naturally.
//
// How to use:
//   The script is a no-op when there is no new per-package entry to mirror.
//   Wire it into the version pipeline:
//
//     "version:packages": "bunx changeset version && bun run scripts/sync-root-changelog.ts"
//
// Changeset body convention (so this script produces a clean root section):
//   Write the body as a narrative: an intro paragraph, then `### Highlights`,
//   `### Features`, `### Fixes`, `### Performance` (or any other sub-headings)
//   with bullets. The github changelog plugin will format the first line as a
//   top-level summary and indent the rest by two spaces for the per-package
//   entry; this script strips that indent when mirroring to the root.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const CLI_CHANGELOG = join(REPO_ROOT, "apps/cli/CHANGELOG.md");
const ROOT_CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");
const CLI_PKG = join(REPO_ROOT, "apps/cli/package.json");

function main(): void {
  if (!existsSync(CLI_CHANGELOG)) {
    console.error("[sync-root-changelog] apps/cli/CHANGELOG.md not found. Skipping.");
    return;
  }

  const cliContent = readFileSync(CLI_CHANGELOG, "utf8");
  const top = parseTopEntry(cliContent);
  if (!top) {
    console.log("[sync-root-changelog] No per-package entry to mirror. Skipping.");
    return;
  }

  if (!existsSync(CLI_PKG)) {
    console.error("[sync-root-changelog] apps/cli/package.json not found. Skipping.");
    return;
  }
  const pkgVersion = (JSON.parse(readFileSync(CLI_PKG, "utf8")) as { version?: string }).version;
  if (!pkgVersion) {
    console.error("[sync-root-changelog] apps/cli/package.json has no version. Skipping.");
    return;
  }
  if (top.version !== pkgVersion) {
    console.warn(
      `[sync-root-changelog] Per-package top (${top.version}) does not match apps/cli/package.json (${pkgVersion}). Skipping to avoid drift.`,
    );
    return;
  }

  const rootKey = `v${top.version}`;
  const rootContent = existsSync(ROOT_CHANGELOG) ? readFileSync(ROOT_CHANGELOG, "utf8") : null;
  if (rootContent !== null && parseRootEntry(rootContent, rootKey) !== null) {
    // Root already has an entry for this version. Skip to avoid clobbering a
    // hand-written or curated section. To re-sync a version, delete its
    // `## vX.Y.Z` block from the root CHANGELOG.md first and re-run.
    console.log(`[sync-root-changelog] Root already has ${rootKey}. Skipping.`);
    return;
  }

  const newSection = `## ${rootKey}\n\n${top.body}\n`;
  let newRoot: string;
  if (rootContent === null) {
    newRoot = `# Changelog\n\n${newSection}\n`;
  } else if (/^# Changelog\s*$/m.test(rootContent)) {
    newRoot = rootContent.replace(/^(# Changelog[ \t]*\n+)/, `$1${newSection}\n`);
  } else {
    newRoot = `# Changelog\n\n${newSection}\n\n${rootContent}`;
  }

  writeFileSync(ROOT_CHANGELOG, newRoot, "utf8");
  console.log(`[sync-root-changelog] Wrote ${rootKey} to root CHANGELOG.md`);
}

interface ChangelogEntry {
  version: string;
  body: string;
}

/** Parses the highest `## X.Y.Z` entry from a per-package changelog. */
function parseTopEntry(content: string): ChangelogEntry | null {
  const re = /^## (\d+\.\d+\.\d+)\n\n([\s\S]*?)(?=\n^## \d+\.\d+\.\d+|$)/m;
  const m = content.match(re);
  if (!m || !m[1] || m[2] === undefined) return null;
  // The github changelog plugin's entry is shaped like:
  //   `### Patch Changes\n\n- [hash](url) Thanks [@author]! - <summary>\n\n  <indented body>`
  // Strip the leading `### Patch Changes\n\n` if present, then drop the first
  // bullet line (the summary), then un-indent the rest.
  let raw = m[2].trim();
  raw = raw.replace(/^### Patch Changes\s*\n+/, "");
  const blank = raw.indexOf("\n\n");
  const indentedBody = blank >= 0 ? raw.slice(blank + 2) : "";
  const unindented = unindent(indentedBody);
  const body = `${m[1]} — ${firstLineSummary(raw)}\n\n${unindented}`.trim();
  return { version: m[1], body };
}

/** Parses a specific `## vX.Y.Z` entry from the root changelog (if present). */
function parseRootEntry(content: string, rootKey: string): ChangelogEntry | null {
  const re = new RegExp(
    `^## ${rootKey.replace(/\./g, "\\.")}\\n\\n([\\s\\S]*?)(?=\\n^## v\\d+\\.\\d+\\.\\d+|$)`,
    "m",
  );
  const m = content.match(re);
  if (!m || m[1] === undefined) return null;
  return { version: rootKey.replace(/^v/, ""), body: m[1].trim() };
}

/** Returns the first bullet's summary text (after the github `Thanks [@author]! -` prefix). */
function firstLineSummary(raw: string): string {
  const firstLine = raw.split("\n", 1)[0] ?? "";
  // Strip leading `- ` and trailing trailing `Thanks [@author]! - ` if present
  let s = firstLine.replace(/^- /, "");
  const thanksIdx = s.indexOf("Thanks ");
  if (thanksIdx > 0) {
    // Skip past the closing `! - `
    const bangIdx = s.indexOf("! - ", thanksIdx);
    if (bangIdx > 0) {
      s = s.slice(bangIdx + 4);
    }
  }
  return s.trim();
}

/** Strips a uniform two-space leading indent from non-empty lines. */
function unindent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

main();
