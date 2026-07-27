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
