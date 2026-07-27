import { getKunaiPaths } from "@kunai/storage";

/**
 * Platform-correct storage roots, re-exported for layers that may not depend on
 * `@kunai/storage` directly.
 *
 * The app-shell is one of those layers (enforced by the boundary test in
 * `test/unit/architecture/boundary-imports.test.ts`), but it still has files
 * that need to know where config lives. Without a seam the choice is between
 * breaking the boundary and hand-rolling the paths — and hand-rolling is what
 * put search history in a literal `./~/.config/kunai/` directory on Windows.
 */
export function kunaiConfigDir(): string {
  return getKunaiPaths().configDir;
}

export function kunaiCacheDir(): string {
  return getKunaiPaths().cacheDir;
}

export function kunaiDataDir(): string {
  return getKunaiPaths().dataDir;
}
