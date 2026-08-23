import { rmSync } from "node:fs";

/**
 * Remove a temp directory that a spawned process may still be holding open.
 *
 * POSIX unlinks a file with an open handle happily — the directory entry goes
 * and the inode survives until the last descriptor closes. Windows refuses: an
 * open handle locks the file, and `rmSync` returns `EBUSY` no matter how many
 * times `force: true` is passed.
 *
 * Tests that spawn a child observe *process exit*, which is not the same event
 * as the OS reclaiming that child's handles and can lag it by a few
 * milliseconds. So teardown races a handle on its way out, and the suite fails
 * in an `afterAll` — reported as `(fail) (unnamed)`, which reads like an
 * unrelated failure and tells the reader nothing about the change under test.
 *
 * Deliberately **not** fixed by sleeping before the delete: a fixed wait is a
 * bet on how fast the host is, which is the shape that makes these suites
 * environment-dependent in the first place. This retries only while the OS is
 * actually refusing, and returns the instant the delete succeeds.
 *
 * A leftover temp directory is not a test failure — the OS reclaims it — so a
 * final refusal warns rather than throws.
 */
export function removeTempDir(
  dir: string | undefined,
  options: {
    readonly attempts?: number;
    /** Injectable so the retry path is testable off Windows, where EBUSY cannot occur. */
    readonly rm?: (path: string) => void;
    readonly onGiveUp?: (message: string) => void;
  } = {},
): void {
  if (!dir) return;

  const attempts = options.attempts ?? 20;
  const rm = options.rm ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
  const onGiveUp = options.onGiveUp ?? ((message: string) => console.warn(message));

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      rm(dir);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Only a held handle is worth retrying. Anything else is a real problem
      // and should surface immediately rather than after a spin.
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") {
        return;
      }
      // Busy-wait briefly: this runs in teardown, and Atomics.wait on a fresh
      // buffer is the only synchronous sleep available without making every
      // caller async.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }

  onGiveUp(
    `removeTempDir: ${dir} is still locked after ${attempts} attempts; leaving it for the OS.`,
  );
}
