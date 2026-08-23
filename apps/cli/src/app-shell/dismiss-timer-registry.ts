export type DismissTimerOperations = {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

const defaultTimerOperations: DismissTimerOperations = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type DismissTimerRegistry = {
  readonly schedule: (callback: () => void, delayMs: number) => void;
  readonly dispose: () => void;
};

export function createDismissTimerRegistry(
  timers: DismissTimerOperations = defaultTimerOperations,
): DismissTimerRegistry {
  const active = new Set<unknown>();

  return {
    schedule(callback, delayMs) {
      let handle: unknown;
      handle = timers.setTimeout(() => {
        active.delete(handle);
        callback();
      }, delayMs);
      active.add(handle);
    },
    dispose() {
      for (const handle of active) timers.clearTimeout(handle);
      active.clear();
    },
  };
}
