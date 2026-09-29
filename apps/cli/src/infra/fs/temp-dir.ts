import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  return mkdtemp(join(tmpdir(), `kunai-${prefix}-`));
}
