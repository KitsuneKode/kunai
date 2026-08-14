#!/usr/bin/env bun
// =============================================================================
// verify-doc-paths.ts — fail when an agent-facing doc cites a path that is gone.
//
// Doc rot in this repo has one dominant cause: a directory gets reorganized and
// the docs that route agents to it keep pointing at the old layout. That is
// silent — nothing breaks until an agent reads the doc and looks in the wrong
// place. This turns it into a build failure.
//
// Checks two things across AGENTS.md and .docs/** (which now contains agents/):
//   1. Backtick-quoted repo paths (`apps/cli/src/...`) resolve on disk.
//   2. Relative markdown links ([x](./y.md)) resolve on disk.
//
// Usage:
//   bun run verify:doc-paths
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/**
 * Docs that route agents. `archive/` is history — its paths are expected to be
 * stale. `provider-dossiers/` is field research citing live sites and captures,
 * not repo layout, so path checking there is noise.
 */
const SCANNED_ROOTS = ["AGENTS.md", ".docs"];
const EXCLUDED_DIRS = new Set(["archive", "node_modules", "provider-dossiers"]);

/**
 * Paths that legitimately do not exist on a clean checkout. Keep this list
 * short and justified — every entry is a place the check cannot help.
 */
const ALLOWED_MISSING: readonly RegExp[] = [
  /^apps\/cli\/dist\//, // build output
  /(^|\/)\.prototypes\//, // gitignored local prototype harnesses
  /\.\.\./, // deliberately elided paths, e.g. packages/storage/.../x.ts
  /[*?]/, // globs
];

/**
 * Docs cite non-existent paths on purpose: to say a file was deleted, or to
 * name a package that is direction rather than code. A line carrying one of
 * these phrases is exempt.
 */
const HISTORICAL_MARKERS = [
  "removed",
  "deleted",
  "retired",
  "no longer exists",
  "not built",
  "does not exist",
];

type Finding = { readonly file: string; readonly target: string; readonly line: number };

function collectMarkdown(entry: string): string[] {
  const abs = join(ROOT, entry);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return abs.endsWith(".md") ? [abs] : [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((child) => {
    if (child.isDirectory()) {
      return EXCLUDED_DIRS.has(child.name) ? [] : collectMarkdown(join(entry, child.name));
    }
    return child.name.endsWith(".md") ? [join(abs, child.name)] : [];
  });
}

function isAllowedMissing(target: string): boolean {
  return ALLOWED_MISSING.some((pattern) => pattern.test(target));
}

function isHistorical(line: string): boolean {
  // Strip markdown emphasis so "has been **removed**" still matches "has been removed".
  const normalized = line.toLowerCase().replace(/[*_`]/g, "");
  return HISTORICAL_MARKERS.some((marker) => normalized.includes(marker));
}

// Only treat a backticked token as a repo path when it starts at a real
// top-level directory and contains a separator — `installId` is an identifier,
// `install.sh` is a file, and only the latter should be checked.
const CODE_PATH =
  /`((?:(?:apps|packages|scripts|archive)\/[A-Za-z0-9._/*?-]+|install\.(?:sh|ps1)))`/g;
const MD_LINK = /\]\(([^)#\s]+\.(?:md|mdx|ts|tsx|json|yaml|yml|sh|ps1|html))(?:#[^)]*)?\)/g;

function checkFile(absolute: string): Finding[] {
  const relative = absolute.slice(ROOT.length + 1);
  const findings: Finding[] = [];

  readFileSync(absolute, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (isHistorical(line)) return;

      for (const [, target] of line.matchAll(CODE_PATH)) {
        if (!target || isAllowedMissing(target)) continue;
        if (!existsSync(join(ROOT, target))) {
          findings.push({ file: relative, target, line: index + 1 });
        }
      }

      for (const [, target] of line.matchAll(MD_LINK)) {
        if (!target || target.startsWith("http") || isAllowedMissing(target)) continue;
        const fromDoc = join(dirname(absolute), target);
        const fromRoot = join(ROOT, target);
        if (!existsSync(fromDoc) && !existsSync(fromRoot)) {
          findings.push({ file: relative, target, line: index + 1 });
        }
      }
    });

  return findings;
}

const files = SCANNED_ROOTS.flatMap(collectMarkdown);
const findings = files.flatMap(checkFile);

if (findings.length > 0) {
  console.error(`\nDead paths in agent-facing docs (${findings.length}):\n`);
  for (const { file, line, target } of findings) {
    console.error(`  ${file}:${line}  →  ${target}`);
  }
  console.error(
    `\nFix the doc, or — if the path is cited as history — say so on the same line
(e.g. "the old x.ts was removed"). Add to ALLOWED_MISSING only when the path
genuinely cannot exist on a clean checkout.\n`,
  );
  process.exit(1);
}

console.log(`verify:doc-paths — ${files.length} docs scanned, all paths resolve.`);
