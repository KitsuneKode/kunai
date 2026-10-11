import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export async function pruneOldDiagnosticFiles({
  dir,
  prefix,
  maxFiles,
}: {
  readonly dir: string;
  readonly prefix: string;
  readonly maxFiles: number;
}): Promise<void> {
  if (maxFiles < 1) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const matching = (
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(prefix))
        .map(async (entry) => {
          const path = join(dir, entry);
          try {
            // `lstat`, so a symlink is judged as itself rather than by whatever
            // it points at. `rm` unlinks the link either way, so following it
            // only ever meant sorting by a target's mtime — and letting a link
            // planted in the diagnostics directory decide which real files are
            // old enough to delete.
            const stats = await lstat(path);
            const prunable = stats.isFile() || stats.isSymbolicLink();
            return prunable ? { entry, path, mtimeMs: stats.mtimeMs } : null;
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
    .slice(maxFiles);

  await Promise.all(stale.map((entry) => rm(entry.path, { force: true })));
}
