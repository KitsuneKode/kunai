/**
 * Environment overrides that redirect Kunai's resolved storage roots into a
 * throwaway directory, on every platform: `KUNAI_CONFIG_DIR` selects a
 * dedicated profile root (`<dir>/config`, `<dir>/data`, `<dir>/cache`), and the
 * legacy per-root variables (`HOME`/`USERPROFILE`, the XDG trio, `APPDATA`/
 * `LOCALAPPDATA`) all point at the same directory so non-profile resolutions —
 * installer scripts, shell readers, older fixtures — land there too.
 * `DO_NOT_TRACK` and the file credential backend keep a sandboxed run from
 * counting as a real install or touching the account-wide OS vault.
 *
 * TMPDIR/TMP/TEMP are deliberately absent: `os.tmpdir()` follows them, so a
 * caller that disposes its root while the env is still applied leaves every
 * later `mkdtemp(join(tmpdir(), …))` in the worker pointing at a deleted
 * directory. Temp scratch under the real tmpdir is also intentional — mpv IPC
 * sockets and playlists live there by design (sun_path length).
 */
export function storageRootEnv(dir: string): Record<string, string> {
  return {
    KUNAI_CONFIG_DIR: dir,
    HOME: dir,
    USERPROFILE: dir,
    XDG_CONFIG_HOME: dir,
    XDG_DATA_HOME: dir,
    XDG_CACHE_HOME: dir,
    APPDATA: dir,
    LOCALAPPDATA: dir,
    DO_NOT_TRACK: "1",
    KUNAI_CREDENTIAL_BACKEND: "file",
  };
}

/**
 * Point this process's storage roots at `dir` and return the undo.
 *
 * `getKunaiPaths` reads `process.env` on every call rather than memoizing, so an
 * in-process swap is enough for a test that drives real code writing real files —
 * no subprocess needed. Restoring exactly what was there, including keys that
 * were unset, keeps one test file from leaking a storage root into the next one
 * in the same worker.
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
