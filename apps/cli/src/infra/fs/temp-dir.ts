import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

/**
 * Create a private temp directory for a file we are about to hand to mpv.
 *
 * `mkdtemp` is the primitive this needs, rather than building a name and
 * calling `mkdir(..., { recursive: true })`:
 *
 * - it fails if the path already exists, where `recursive: true` succeeds, so
 *   another local user cannot pre-create (or symlink) the directory we are
 *   about to write a playlist or MPD into and have us adopt it
 * - it creates with mode 0700, so the contents are not world-readable
 * - the suffix comes from the OS, not `Math.random()`, which is not a CSPRNG
 *   and is trivially predictable from a `Date.now()`-seeded prefix
 *
 * This only matters on a shared machine, where `/tmp` is writable by other
 * users — but that is exactly where a wrong playlist gets handed to the player.
 *
 * @param prefix short label for the directory name, e.g. `"hls"` or `"media"`.
 */
export async function createPrivateTempDir(prefix: string): Promise<string> {
  // Honor the isolated storage root (HOME/XDG/APPDATA redirects) instead of
  // the raw OS tmp: sandboxed runs and tests that redirect the storage root
  // otherwise scatter playlists, MPDs, and chapter files into the shared OS
  // tmp — the same live-profile-adjacent leak class as writing the real
  // profile. getKunaiPaths() falls back to os.tmpdir() when no root is
  // configured, so unconfigured runs keep today's layout under `<tmp>/kunai/`.
  const root = getKunaiPaths().tempDir;
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `kunai-${prefix}-`));
}
