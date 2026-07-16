import { describe, expect, test } from "bun:test";

import { startDownloadStatusMonitor } from "@/app-shell/download-status-monitor";

describe("download status monitor", () => {
  test("does not keep a polling interval while the queue is idle", () => {
    let active = false;
    let listener: (() => void) | undefined;
    let refreshes = 0;
    let intervalStarts = 0;
    let intervalStops = 0;

    const stop = startDownloadStatusMonitor({
      source: {
        hasActiveJobs: () => active,
        onEvent: (handler) => {
          listener = handler;
          return () => {
            listener = undefined;
          };
        },
      },
      refresh: () => {
        refreshes += 1;
      },
      timers: {
        setInterval: () => {
          intervalStarts += 1;
          return 1;
        },
        clearInterval: () => {
          intervalStops += 1;
        },
      },
    });

    expect(refreshes).toBe(1);
    expect(intervalStarts).toBe(0);

    active = true;
    listener?.();
    expect(refreshes).toBe(2);
    expect(intervalStarts).toBe(1);

    active = false;
    listener?.();
    expect(refreshes).toBe(3);
    expect(intervalStops).toBe(1);

    stop();
    expect(listener).toBeUndefined();
    expect(intervalStops).toBe(1);
  });
});
