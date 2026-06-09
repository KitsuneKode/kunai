/** Best-effort registry of live mpv child processes for synchronous teardown on exit. */

export type MpvKillableProcess = {
  kill(signal?: NodeJS.Signals): void;
};

const activeProcesses = new Set<MpvKillableProcess>();

export function registerMpvProcess(process: MpvKillableProcess): () => void {
  activeProcesses.add(process);
  return () => {
    activeProcesses.delete(process);
  };
}

/**
 * Synchronously SIGKILL every in-flight mpv child. Meant for `process.on("exit")`
 * when async shutdown can lose its race with the force-exit timer.
 */
export function killActiveMpvProcessesSync(): void {
  for (const process of activeProcesses) {
    try {
      process.kill("SIGKILL");
    } catch {
      // best effort — process may already be gone
    }
  }
  activeProcesses.clear();
}
