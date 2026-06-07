let exitInProgress = false;
const exitHandlers: (() => Promise<void>)[] = [];
const HANDLER_TIMEOUT_MS = 2000;

export function registerExitHandler(handler: () => Promise<void>): () => void {
  exitHandlers.push(handler);
  return () => {
    const idx = exitHandlers.indexOf(handler);
    if (idx >= 0) {
      exitHandlers.splice(idx, 1);
    }
  };
}

async function runExitHandlers(): Promise<void> {
  for (const handler of exitHandlers) {
    try {
      await Promise.race([
        handler(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Exit handler timed out")), HANDLER_TIMEOUT_MS),
        ),
      ]);
    } catch (error) {
      console.error("Exit handler failed:", error);
    }
  }
}

export function requestHardExit(code = 0): void {
  if (exitInProgress) return;
  exitInProgress = true;
  const forceExit = setTimeout(() => process.exit(code), 4000);
  if (forceExit.unref) forceExit.unref();
  void runExitHandlers().finally(() => {
    clearTimeout(forceExit);
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(code);
  });
}
