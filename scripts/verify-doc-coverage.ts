#!/usr/bin/env bun
// =============================================================================
// verify-doc-coverage.ts — fail when a code area has no route in the feature map.
//
// verify-doc-paths.ts catches docs pointing at code that moved. This catches the
// opposite: code that exists with nothing pointing at it. A directory nobody
// documented is a directory the next agent will either miss or reimplement.
//
// Every second-level directory under apps/cli/src/{services,domain,infra,app}
// and every packages/* must appear somewhere in .docs/feature-map.md.
//
// Usage:
//   bun run verify:doc-coverage
// =============================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FEATURE_MAP = join(ROOT, ".docs/feature-map.md");

/** Roots whose immediate subdirectories each need a route. */
const COVERED_ROOTS = [
  "apps/cli/src/services",
  "apps/cli/src/domain",
  "apps/cli/src/infra",
  "apps/cli/src/app",
  "packages",
];

/**
 * Directories deliberately absent from the feature map. Each needs a reason —
 * "it is small" is not one. Prefer adding a row over adding an entry here.
 */
const EXEMPT = new Map<string, string>([
  ["apps/cli/src/app/compiled-smoke", "test fixture provider, not a runtime feature"],
]);

function subdirectories(relativeRoot: string): string[] {
  const absolute = join(ROOT, relativeRoot);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${relativeRoot}/${entry.name}`);
}

const featureMap = readFileSync(FEATURE_MAP, "utf8");

/**
 * A directory counts as routed if the map names its path, or names it as a
 * bare segment under a shorthand parent (the map writes `services/youtube/*`
 * as often as the full path).
 */
function isRouted(directory: string): boolean {
  if (featureMap.includes(directory)) return true;
  const shorthand = directory.replace(/^apps\/cli\/src\//, "");
  if (featureMap.includes(shorthand)) return true;
  const packageName = directory.replace(/^packages\//, "@kunai/");
  return featureMap.includes(packageName);
}

const missing = COVERED_ROOTS.flatMap(subdirectories)
  .filter((directory) => !EXEMPT.has(directory))
  .filter((directory) => !isRouted(directory));

if (missing.length > 0) {
  console.error(`\nCode areas with no route in .docs/feature-map.md (${missing.length}):\n`);
  for (const directory of missing) {
    const fileCount = readdirSync(join(ROOT, directory)).length;
    console.error(`  ${directory}  (${fileCount} entries)`);
  }
  console.error(
    `\nAdd a row to .docs/feature-map.md saying what owns this area, or add it to
EXEMPT with a reason. A directory nobody routed is one the next agent misses.\n`,
  );
  process.exit(1);
}

console.log(
  `verify:doc-coverage — every code area under ${COVERED_ROOTS.length} roots is routed in the feature map.`,
);
