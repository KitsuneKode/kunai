// =============================================================================
// Shutdown coordinator — one bounded, ordered exit path for the live app.
//
// Every handled exit (normal quit, shell request, signal, fatal error)
// converges on a single in-flight sequence:
//   quiesce → restore terminal → preserve critical state →
//   release external resources → dispose → exit.
// Phases are failure-isolated: one failing phase is recorded and the rest
// still run, because critical-state preservation must never be skipped.
// A global deadline aborts a hung external release and forces the exit.
// =============================================================================

export type ShutdownIntent = {
  readonly reason: string;
  readonly exitCode: number;
  readonly fatal?: boolean;
};

export type ShutdownPhase =
  | "quiesce"
  | "restore-terminal"
  | "preserve-critical-state"
  | "release-external-resources"
  | "dispose";

export type ShutdownRuntime = {
  quiesce(intent: ShutdownIntent): Promise<void>;
  restoreTerminal(intent: ShutdownIntent): Promise<void>;
  preserveCriticalState(intent: ShutdownIntent): Promise<void>;
  releaseExternalResources(intent: ShutdownIntent, signal: AbortSignal): Promise<void>;
  dispose(intent: ShutdownIntent): Promise<void>;
  recordFailure(phase: ShutdownPhase, error: unknown): void;
  unrefStdin(): void;
  exit(code: number): void;
};

export type ShutdownCoordinator = {
  request(intent: ShutdownIntent): Promise<void>;
  isShuttingDown(): boolean;
};

const DEFAULT_DEADLINE_MS = 4_000;

export function createShutdownCoordinator(
  runtime: ShutdownRuntime,
  options: { readonly deadlineMs?: number } = {},
): ShutdownCoordinator {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  let inFlight: Promise<void> | null = null;
  let finalExitCode = 0;
  let exited = false;

  const runPhase = async (phase: ShutdownPhase, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      try {
        runtime.recordFailure(phase, error);
      } catch {
        // recording must never break the shutdown sequence
      }
    }
  };

  const exitOnce = (): void => {
    if (exited) return;
    exited = true;
    try {
      runtime.unrefStdin();
    } catch {
      // stdin may already be closed
    }
    runtime.exit(finalExitCode);
  };

  const run = async (intent: ShutdownIntent): Promise<void> => {
    const releaseAbort = new AbortController();
    const forceExit = setTimeout(() => {
      releaseAbort.abort(new Error(`shutdown deadline (${deadlineMs}ms) exceeded`));
      exitOnce();
    }, deadlineMs);
    forceExit.unref?.();

    try {
      await runPhase("quiesce", () => runtime.quiesce(intent));
      await runPhase("restore-terminal", () => runtime.restoreTerminal(intent));
      await runPhase("preserve-critical-state", () => runtime.preserveCriticalState(intent));
      await runPhase("release-external-resources", () =>
        runtime.releaseExternalResources(intent, releaseAbort.signal),
      );
      await runPhase("dispose", () => runtime.dispose(intent));
    } finally {
      clearTimeout(forceExit);
      exitOnce();
    }
  };

  return {
    request(intent: ShutdownIntent): Promise<void> {
      if (intent.fatal || intent.exitCode !== 0) {
        finalExitCode =
          finalExitCode === 0 ? intent.exitCode : Math.max(finalExitCode, intent.exitCode);
      }
      if (inFlight) return inFlight;
      inFlight = run(intent);
      return inFlight;
    },
    isShuttingDown(): boolean {
      return inFlight !== null;
    },
  };
}
