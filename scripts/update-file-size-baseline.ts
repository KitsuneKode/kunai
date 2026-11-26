#!/usr/bin/env bun
// =============================================================================
// update-file-size-baseline.ts — shrink-only regenerator for the file-size ratchet.
//
// `apps/cli/test/unit/architecture/file-size-ratchet.test.ts` enforces that no
// source file in `apps/*/src` or `packages/*/src` exceeds 800 lines unless it
// is grandfathered in `file-size-baseline.json` — and grandfathered files may
// never grow.
//
// This script regenerates the baseline ONLY when every change is a shrink or
// deletion (or when seeding an initial baseline). Raising a ceiling or adding
// a new file over 800 lines is refused so any intentional bump has to be a
// deliberate, reviewable hand edit to the JSON file.
//
// Usage:
//   bun run ratchet:file-size:update
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type FileSizeBaseline = Record<string, number>;

export type FileSizeGrowth = {
  readonly file: string;
  readonly baseline: number;
  readonly lines: number;
};

export type FileSizeOverLimit = {
  readonly file: string;
  readonly lines: number;
};

export type FileSizeRemoved = {
  readonly file: string;
  readonly baseline: number;
};

export type FileSizeDrift = {
  readonly grew: readonly FileSizeGrowth[];
  readonly overLimit: readonly FileSizeOverLimit[];
  readonly shrunk: readonly FileSizeGrowth[];
  readonly removed: readonly FileSizeRemoved[];
};

export const MAX_SOURCE_FILE_LINES = 800;

const REPO_ROOT = resolve(import.meta.dirname, "..");
export const FILE_SIZE_BASELINE_RELATIVE_PATH =
  "apps/cli/test/unit/architecture/file-size-baseline.json";
const BASELINE_PATH = resolve(REPO_ROOT, FILE_SIZE_BASELINE_RELATIVE_PATH);

const SKIP_DIRS = new Set(["node_modules", "dist", "legacy", ".turbo", ".next"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

/** Count lines across LF and CRLF without allocating line arrays. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return text.charCodeAt(text.length - 1) === 10 ? count : count + 1;
}

/** Discover every `apps/<name>/src` and `packages/<name>/src` directory. */
export function discoverSourceRoots(repoRoot: string = REPO_ROOT): string[] {
  const roots: string[] = [];
  for (const group of ["apps", "packages"] as const) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srcDir = join(groupDir, entry.name, "src");
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
        roots.push(`${group}/${entry.name}/src`);
      }
    }
  }
  return roots.sort((a, b) => a.localeCompare(b));
}

/** Collect line counts for every source file under apps/<name>/src and packages/<name>/src. */
export function scanSourceFileLineCounts(repoRoot: string = REPO_ROOT): Map<string, number> {
  const counts = new Map<string, number>();

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      const rel = relative(repoRoot, absolute).replaceAll("\\", "/");
      counts.set(rel, countLines(readFileSync(absolute, "utf8")));
    }
  };

  for (const root of discoverSourceRoots(repoRoot)) {
    walk(join(repoRoot, root));
  }
  return counts;
}

export function diffFileSizeBaseline(
  baseline: FileSizeBaseline,
  current: ReadonlyMap<string, number>,
  maxLines: number = MAX_SOURCE_FILE_LINES,
): FileSizeDrift {
  const grew: FileSizeGrowth[] = [];
  const overLimit: FileSizeOverLimit[] = [];
  const shrunk: FileSizeGrowth[] = [];
  const removed: FileSizeRemoved[] = [];

  const allFiles = [...new Set([...Object.keys(baseline), ...current.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  for (const file of allFiles) {
    const base = baseline[file];
    const lines = current.get(file);

    if (base !== undefined) {
      if (lines === undefined) {
        removed.push({ file, baseline: base });
      } else if (lines > base) {
        grew.push({ file, baseline: base, lines });
      } else if (lines < base) {
        shrunk.push({ file, baseline: base, lines });
      }
      continue;
    }

    if (lines !== undefined && lines > maxLines) {
      overLimit.push({ file, lines });
    }
  }

  return { grew, overLimit, shrunk, removed };
}

/**
 * Regenerating the baseline may only lower or drop entries (or seed the very
 * first baseline). Refusing to raise ceilings prevents self-serve bypasses.
 */
export function canLowerFileSizeBaseline(hadBaseline: boolean, drift: FileSizeDrift): boolean {
  return !hadBaseline || (drift.grew.length === 0 && drift.overLimit.length === 0);
}

export function buildFileSizeBaseline(
  current: ReadonlyMap<string, number>,
  maxLines: number = MAX_SOURCE_FILE_LINES,
): FileSizeBaseline {
  const entries = [...current.entries()]
    .filter(([, lines]) => lines > maxLines)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

async function main(): Promise<void> {
  const hadBaseline = existsSync(BASELINE_PATH);
  // SAFETY: baseline JSON is a checked-in flat path->line-count map maintained by this script.
  const previous: FileSizeBaseline = hadBaseline
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as FileSizeBaseline)
    : {};
  const current = scanSourceFileLineCounts(REPO_ROOT);
  const drift = diffFileSizeBaseline(previous, current);

  if (!canLowerFileSizeBaseline(hadBaseline, drift)) {
    for (const item of drift.grew) {
      console.error(
        `[file-size-ratchet] GREW ${item.file}: ${item.baseline} -> ${item.lines} (+${item.lines - item.baseline})`,
      );
    }
    for (const item of drift.overLimit) {
      console.error(
        `[file-size-ratchet] OVER LIMIT ${item.file}: ${item.lines} lines (max ${MAX_SOURCE_FILE_LINES})`,
      );
    }
    console.error(
      `[file-size-ratchet] FAIL: refusing to raise ceilings or add new files over ${MAX_SOURCE_FILE_LINES} lines — split the file instead.`,
    );
    process.exit(1);
  }

  const next = buildFileSizeBaseline(current);
  await Bun.write(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `[file-size-ratchet] wrote ${Object.keys(next).length} baselined file(s) to ${FILE_SIZE_BASELINE_RELATIVE_PATH}` +
      (hadBaseline
        ? ` (${drift.shrunk.length} lowered, ${drift.removed.length} removed)`
        : " (initial baseline)"),
  );
}

if (import.meta.main) {
  await main();
}
