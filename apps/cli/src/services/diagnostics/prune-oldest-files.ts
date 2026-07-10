import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Keep the newest `keep` files in `dir` whose names match `pattern`.
 * Older matches are deleted. No-op when `keep < 1` or the directory is missing.
 */
export async function pruneOldestFiles(dir: string, pattern: RegExp, keep: number): Promise<void> {
  if (keep < 1) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const matching = (
    await Promise.all(
      entries
        .filter((entry) => pattern.test(entry))
        .map(async (entry) => {
          const path = join(dir, entry);
          try {
            const stats = await stat(path);
            return stats.isFile() ? { entry, path, mtimeMs: stats.mtimeMs } : null;
          } catch {
            return null;
          }
        }),
    )
  ).filter(
    (entry): entry is { readonly entry: string; readonly path: string; readonly mtimeMs: number } =>
      Boolean(entry),
  );

  const stale = matching
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.entry.localeCompare(left.entry))
    .slice(keep);

  await Promise.all(stale.map((entry) => rm(entry.path, { force: true })));
}
