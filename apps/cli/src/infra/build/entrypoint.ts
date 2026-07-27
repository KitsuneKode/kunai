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
 * Comparing the same two paths with Windows separators and case normalised
 * answers correctly in the compiled binary. POSIX paths remain byte-for-byte:
 * their filesystems may be case-sensitive and a backslash is a legal filename
 * character, so applying Windows identity rules there could turn an imported
 * module into a false entrypoint.
 */
export function isProcessEntrypoint(
  meta: ImportMeta,
  mainPath: string = Bun.main,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (meta.main) return true;

  if (typeof mainPath !== "string" || mainPath.length === 0) return false;
  if (typeof meta.path !== "string" || meta.path.length === 0) return false;

  return (
    normalizeEntrypointPath(meta.path, platform) === normalizeEntrypointPath(mainPath, platform)
  );
}

/** Platform-correct form used only for entrypoint identity. */
export function normalizeEntrypointPath(path: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.replace(/\\/g, "/").toLowerCase() : path;
}
