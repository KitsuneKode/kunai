import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function findRepoRoot(start: string): string {
  let directory = start;
  while (directory !== dirname(directory)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (Array.isArray(packageJson.workspaces)) {
        return directory;
      }
    } catch {
      // Keep walking toward the filesystem root.
    }
    directory = dirname(directory);
  }
  return start;
}

const REPO_ROOT = findRepoRoot(process.cwd());
const ACTIVE_ROOTS = [
  "apps/cli/src",
  "packages/core/src",
  "packages/storage/src",
  "packages/types/src",
];
const SKIP_DIRS = new Set(["legacy", "node_modules", "dist"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function collectSourceFiles(root: string): string[] {
  const absoluteRoot = join(REPO_ROOT, root);
  const files: string[] = [];

  function walk(directory: string) {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      const relativePath = relative(REPO_ROOT, absolute);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        if (SKIP_DIRS.has(entry) || relativePath.startsWith("apps/experiments")) {
          continue;
        }
        walk(absolute);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        files.push(relativePath);
      }
    }
  }

  walk(absoluteRoot);
  return files;
}

describe("runtime boundary imports", () => {
  test("active runtime code does not import legacy or experiments modules", () => {
    const offenders = ACTIVE_ROOTS.flatMap(collectSourceFiles).filter((file) => {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      return /from\s+["'][^"']*(?:legacy|experiments)[^"']*["']/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
