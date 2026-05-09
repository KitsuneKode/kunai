let exitInProgress = false;
let beforeExitHandler: (() => Promise<void> | void) | null = null;

export function registerBeforeHardExit(handler: () => Promise<void> | void): () => void {
  beforeExitHandler = handler;
  return () => {
    if (beforeExitHandler === handler) {
      beforeExitHandler = null;
    }
  };
}

export function requestHardExit(code = 0): void {
  if (exitInProgress) return;
  exitInProgress = true;
  void (async () => {
    try {
      await beforeExitHandler?.();
    } finally {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(code);
    }
  })();
}
