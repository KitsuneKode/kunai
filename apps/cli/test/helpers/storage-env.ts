/**
 * Environment overrides that redirect Kunai's resolved storage roots into a
 * throwaway directory, on every platform.
 *
 * `XDG_CACHE_HOME` alone is not enough. It is a freedesktop convention that
 * `getKunaiPaths` honours only on Linux; on Windows the cache root comes from
 * `LOCALAPPDATA` and on macOS from `~/Library/Caches`. A test that sets only the
 * XDG variable therefore isolates nothing on Windows — it reads and writes the
 * developer's *real* cache, so results depend on machine state and the run
 * leaves artifacts behind.
 *
 * Setting the full set keeps one call correct everywhere: the variables that do
 * not apply to the host are simply ignored.
 */
export function storageRootEnv(dir: string): Record<string, string> {
  return {
    // Linux (freedesktop).
    XDG_CACHE_HOME: dir,
    XDG_DATA_HOME: dir,
    XDG_CONFIG_HOME: dir,
    // Windows.
    LOCALAPPDATA: dir,
    APPDATA: dir,
    // macOS and the `homedir()` fallbacks both derive from HOME/USERPROFILE.
    HOME: dir,
    USERPROFILE: dir,
  };
}

/**
 * Point this process's storage roots at `dir` and return the undo.
 *
 * `getKunaiPaths` reads `process.env` (and `homedir()`, which reads `HOME`) on
 * every call rather than memoizing, so an in-process swap is enough for a test
 * that drives real code writing real files — no subprocess needed. Restoring
 * exactly what was there, including keys that were unset, keeps one test file
 * from leaking a storage root into the next one in the same worker.
 */
export function applyStorageRootEnv(dir: string): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(storageRootEnv(dir))) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
