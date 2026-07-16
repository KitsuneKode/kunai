export type DownloadStatusSource = {
  readonly hasActiveJobs: () => boolean;
  readonly onEvent: (handler: () => void) => () => void;
};

type TimerPort = {
  readonly setInterval: (handler: () => void, delayMs: number) => unknown;
  readonly clearInterval: (timer: unknown) => void;
};

const systemTimers: TimerPort = {
  setInterval: (handler, delayMs) => setInterval(handler, delayMs),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

/**
 * Keeps the download stripe current without waking the whole Ink root while the
 * queue is idle. Download events start and stop the fallback poll as job state
 * changes; the poll only covers long-running jobs whose progress may be quiet.
 */
export function startDownloadStatusMonitor({
  source,
  refresh,
  intervalMs = 2_000,
  timers = systemTimers,
}: {
  readonly source: DownloadStatusSource;
  readonly refresh: () => void;
  readonly intervalMs?: number;
  readonly timers?: TimerPort;
}): () => void {
  let timer: unknown;

  const syncPolling = () => {
    if (source.hasActiveJobs()) {
      timer ??= timers.setInterval(refresh, intervalMs);
      return;
    }
    if (timer !== undefined) {
      timers.clearInterval(timer);
      timer = undefined;
    }
  };

  refresh();
  syncPolling();
  const unsubscribe = source.onEvent(() => {
    refresh();
    syncPolling();
  });

  return () => {
    unsubscribe();
    if (timer !== undefined) timers.clearInterval(timer);
  };
}
