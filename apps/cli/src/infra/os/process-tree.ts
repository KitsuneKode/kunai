import { spawnSync } from "node:child_process";

/**
 * Kill a spawned child *and* the processes it spawned. A bare `proc.kill`
 * reaches only the direct child — mpv's ytdl_hook yt-dlp or yt-dlp's ffmpeg
 * mux helper would be orphaned, holding temp files, sockets, and bandwidth
 * after Kunai is gone.
 *
 * Two mechanisms, one per platform:
 * - Windows: `taskkill /pid /T /F` walks the whole tree (in-box everywhere).
 * - POSIX: `kill(-pid)` reaches the process group — but only when the child
 *   was spawned `detached` (group leader). For shared-group children a
 *   `pkill -P` sweep hits direct descendants instead; grandchildren below
 *   them are not reachable in the mpv case (its yt-dlp streams, no muxing).
 */

export type TreeKillableProcess = {
  /** Present on `Bun.spawn` results; absent on injected test fakes. */
  readonly pid?: number;
  kill(signal?: string | number): void;
};

function descendantsSweep(pid: number, signal: string): void {
  try {
    // Direct children only; `-P` resolves PPID at match time so a dead parent
    // first would re-parent the grandchildren out from under the sweep.
    spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
  } catch {
    // pkill absent on minimal containers — the direct kill still lands.
  }
}

export function terminateProcessTree(
  proc: TreeKillableProcess,
  signal: NodeJS.Signals = "SIGKILL",
  options: { readonly detached?: boolean } = {},
): void {
  const pid = proc.pid;
  if (process.platform === "win32") {
    if (pid !== undefined && pid > 0) {
      try {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
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
      process.kill(-pid, signal);
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
