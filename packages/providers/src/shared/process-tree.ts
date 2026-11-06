/**
 * Kill a spawned child *and* the processes it spawned. A bare `proc.kill`
 * reaches only the direct child — yt-dlp's ffmpeg mux helper or mpv's
 * ytdl_hook child would be orphaned, holding temp files, sockets, and
 * bandwidth after Kunai is gone.
 *
 * The caller signals which spawn shape it used: POSIX `detached` spawns are
 * process-group leaders, so `kill(-pid)` reaches the whole tree — including
 * grandchildren still alive after the leader exits. Windows has no group
 * signals; `taskkill /T` walks the tree instead.
 */

export type TreeKillableProcess = {
  /** Present on `Bun.spawn` results; absent on injected test fakes. */
  readonly pid?: number;
  kill(signal?: string | number): void;
};

function descendantsSweep(pid: number, signal: string | number): void {
  try {
    // Direct children only; `-P` resolves PPID at match time so a dead parent
    // first would re-parent the grandchildren out from under the sweep.
    Bun.spawnSync({
      cmd: ["pkill", `-${signal}`, "-P", String(pid)],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
  } catch {
    // pkill absent on minimal containers — the direct kill still lands.
  }
}

export function terminateProcessTree(
  proc: TreeKillableProcess,
  signal: string | number = "SIGKILL",
  options: { readonly detached?: boolean } = {},
): void {
  const pid = proc.pid;
  if (process.platform === "win32") {
    if (pid !== undefined && pid > 0) {
      try {
        // `/T` walks descendants, `/F` forces — in-box on every supported
        // Windows and the only tree primitive short of Job Objects.
        Bun.spawnSync({
          cmd: ["taskkill", "/pid", String(pid), "/T", "/F"],
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
        });
        return;
      } catch {
        // Fall through to the direct kill.
      }
    }
    try {
      proc.kill(signal);
    } catch {
      // Process may already be gone.
    }
    return;
  }

  if (options.detached && pid !== undefined && pid > 0) {
    try {
      // Negative pid = the child's process group. Only used when *we* set
      // `detached` — group-killing an arbitrary pid could hit an unrelated
      // group after pid reuse.
      // SAFETY: callers pass the same Signals literals proc.kill accepts —
      // the two signal vocabularies are identical on POSIX.
      process.kill(-pid, signal as NodeJS.Signals);
      return;
    } catch {
      // Leader gone but no group? Fall through to the direct kill.
    }
  }

  if (pid !== undefined && pid > 0) descendantsSweep(pid, signal);
  try {
    proc.kill(signal);
  } catch {
    // Process may already be gone.
  }
}
