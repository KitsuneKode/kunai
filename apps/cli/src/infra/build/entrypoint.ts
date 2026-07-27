/**
 * Is this module the process entrypoint?
 *
 * `import.meta.main` is the natural answer and is correct everywhere Kunai runs
 * from source. It is not correct inside a `bun build --compile` binary on
 * Windows: Bun decides it by comparing the module's own path against the main
 * specifier, and in a compiled Windows executable those two disagree on
 * separators — `import.meta.path` is `B:\~BUN\root\main.js` while `Bun.main` is
 * `B:/~BUN/root/main.js`. The comparison fails, `import.meta.main` is false for
 * the entry module, and `kunai.exe --version` exits 0 having printed nothing
 * because the startup call behind the guard never ran.
 *
 * Comparing the same two paths with separators normalised answers correctly in
 * every case: from source, from the npm bundle, and from a compiled binary on
 * every platform. `import.meta.main` is still consulted first so the ordinary
 * path keeps Bun's own answer.
 *
 * Case is folded because Windows paths are case-insensitive; on POSIX the two
 * strings come from the same source and match exactly regardless.
 */
export function isProcessEntrypoint(meta: ImportMeta, mainPath: string = Bun.main): boolean {
  if (meta.main) return true;

  if (typeof mainPath !== "string" || mainPath.length === 0) return false;
  if (typeof meta.path !== "string" || meta.path.length === 0) return false;

  return normalizeEntrypointPath(meta.path) === normalizeEntrypointPath(mainPath);
}

/** Separator- and case-normalised form used only for entrypoint identity. */
export function normalizeEntrypointPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
