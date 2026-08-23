import {
  type BackgroundWorkDrainResult,
  type BackgroundWorkScheduler,
} from "@/services/background/BackgroundWorkScheduler";

export type PostPaintStartupTask = {
  readonly id: string;
  readonly run: () => Promise<void> | void;
};

export type PostPaintStartupWorkInput = {
  readonly scheduler: Pick<BackgroundWorkScheduler, "drain" | "enqueue">;
  readonly tasks: readonly PostPaintStartupTask[];
  readonly yieldToPaint?: (signal: AbortSignal) => Promise<void>;
};

export type ShellPostPaintStartupWorkInput = PostPaintStartupWorkInput & {
  readonly launchShell: () => void;
  readonly recordShellMounted: () => void;
};

/** Establish the shell boundary before admitting any startup SQLite work. */
export function launchShellWithPostPaintStartupWork(
  input: ShellPostPaintStartupWorkInput,
): Promise<BackgroundWorkDrainResult> {
  input.launchShell();
  input.recordShellMounted();
  return schedulePostPaintStartupWork(input);
}

/**
 * Admit startup database work only after the root shell has mounted. Every
 * item yields one event-loop turn before touching synchronous SQLite. Each
 * predecessor admits its successor from `finally`, so failures cannot break
 * ordering and shutdown can reject later admission before database disposal.
 */
export function schedulePostPaintStartupWork(
  input: PostPaintStartupWorkInput,
): Promise<BackgroundWorkDrainResult> {
  const yieldToPaint = input.yieldToPaint ?? yieldOneEventLoopTurn;
  const enqueueTask = (index: number): void => {
    const task = input.tasks[index];
    if (!task) return;
    input.scheduler.enqueue({
      id: `startup.${String(index + 1).padStart(2, "0")}.${task.id}`,
      lane: "maintenance-cleanup",
      run: async (signal) => {
        try {
          await yieldToPaint(signal);
          signal.throwIfAborted();
          await task.run();
        } finally {
          enqueueTask(index + 1);
        }
      },
    });
  };

  enqueueTask(0);
  return input.scheduler.drain();
}

async function yieldOneEventLoopTurn(signal: AbortSignal): Promise<void> {
  await Bun.sleep(0);
  signal.throwIfAborted();
}
