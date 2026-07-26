import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Shared filesystem scanning for the architecture sweeps.
 *
 * Every path this module hands back is POSIX-separated, on every platform. The
 * sweeps compare scan results against hand-written allowlists, skip prefixes and
 * baseline sets that are all written with forward slashes, so a raw
 * `path.relative` result -- backslashed on Windows -- misses every one of those
 * comparisons at once: allowlisted imports become offenders, skip prefixes stop
 * matching, and the sweeps fail en masse on Windows while passing on Linux.
 * Normalising here keeps that fix in one place instead of at each comparison.
 */

const SKIP_DIRS = new Set(["node_modules", "dist", "legacy", ".turbo"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/** Convert a native path to POSIX separators. No-op off Windows. */
export function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Nearest ancestor directory whose package.json declares workspaces. */
export function findRepoRoot(start: string): string {
  let directory = start;
  while (directory !== dirname(directory)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (packageJson.workspaces !== undefined) return directory;
    } catch {
      // Keep walking toward the filesystem root.
    }
    directory = dirname(directory);
  }
  return start;
}

export const REPO_ROOT = findRepoRoot(process.cwd());

export type CollectSourceFilesOptions = {
  /** Extra directory names to skip, beyond node_modules/dist/legacy/.turbo. */
  readonly skipDirs?: readonly string[];
  /** Repo-relative POSIX prefixes to skip, matched against the walked path. */
  readonly skipPrefixes?: readonly string[];
  /** File extensions to collect. Defaults to .ts and .tsx. */
  readonly extensions?: readonly string[];
};

/**
 * Repo-relative POSIX paths of every source file under `rootRelative`.
 *
 * Missing roots yield an empty list rather than throwing so a sweep over
 * several roots is not taken down by one that has not been created yet.
 */
export function collectSourceFiles(
  rootRelative: string,
  options: CollectSourceFilesOptions = {},
): string[] {
  const skipDirs = new Set([...SKIP_DIRS, ...(options.skipDirs ?? [])]);
  const skipPrefixes = options.skipPrefixes ?? [];
  const extensions = options.extensions ?? SOURCE_EXTENSIONS;
  const files: string[] = [];

  const walk = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry);
      const relativePath = toPosixPath(relative(REPO_ROOT, absolute));
      if (skipPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;
      if (statSync(absolute).isDirectory()) {
        if (skipDirs.has(entry)) continue;
        walk(absolute);
        continue;
      }
      if (extensions.some((extension) => entry.endsWith(extension))) {
        files.push(relativePath);
      }
    }
  };

  walk(join(REPO_ROOT, rootRelative));
  return files;
}

/** Read a repo-relative POSIX path collected by {@link collectSourceFiles}. */
export function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}
