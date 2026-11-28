import { registerMpvProcess, type MpvChildProcess } from "@/infra/player/mpv-process-registry";

/**
 * The trailer window is detached mpv — no IPC socket, no session — so it lives
 * in the process registry instead: quit-time teardown kills it like the main
 * player, and a re-press replaces the running one rather than stacking
 * windows on a key mash.
 */
let liveTrailerProcess: MpvChildProcess | null = null;

export function spawnTrailerMpv(argv: readonly string[], target: string): boolean {
  if (liveTrailerProcess && liveTrailerProcess.exitCode === null) {
    try {
      liveTrailerProcess.kill("SIGTERM");
    } catch {
      // Already gone between the liveness check and the kill.
    }
  }
  const proc = Bun.spawn([...argv, "--", target], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  liveTrailerProcess = proc;
  const unregister = registerMpvProcess(proc);
  void proc.exited.then(unregister, unregister);
  return true;
}
