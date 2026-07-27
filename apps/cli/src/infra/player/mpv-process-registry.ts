/** Best-effort registry of live mpv child processes for synchronous teardown on exit. */

export type MpvKillableProcess = {
  kill(signal?: NodeJS.Signals): void;
};

export type MpvChildProcess = MpvKillableProcess & {
  exited: Promise<number>;
  exitCode: number | null;
};

export type MpvTerminationResult = {
  exited: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
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

/**
 * Stop one owned mpv child and do not release ownership until it has exited (or
 * both bounded waits have expired). This is used on bootstrap failures where
 * returning to provider fallback while the old player is still alive would
 * allow multiple mpv windows to stack up.
 */
export async function terminateMpvProcess(
  process: MpvChildProcess,
  options: {
    gracefulTimeoutMs?: number;
    forceTimeoutMs?: number;
    sleep?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<MpvTerminationResult> {
  const sleep = options.sleep ?? Bun.sleep;

  const waitForExit = async (timeoutMs: number): Promise<number | null | undefined> =>
    await Promise.race([
      process.exited.then(
        (code) => code,
        () => null,
      ),
      sleep(timeoutMs).then(() => undefined),
    ]);

  try {
    process.kill("SIGTERM");
  } catch {
    // The child may have exited between the readiness failure and teardown.
  }

  const gracefulCode = await waitForExit(options.gracefulTimeoutMs ?? 1_500);
  if (gracefulCode !== undefined) {
    return {
      exited: true,
      exitCode: process.exitCode ?? gracefulCode,
      signal: "SIGTERM",
    };
  }

  try {
    process.kill("SIGKILL");
  } catch {
    // Same exit race as above; the final bounded wait reconciles it.
  }

  const forcedCode = await waitForExit(options.forceTimeoutMs ?? 1_000);
  return {
    exited: forcedCode !== undefined,
    exitCode: process.exitCode ?? forcedCode ?? null,
    signal: "SIGKILL",
  };
}
