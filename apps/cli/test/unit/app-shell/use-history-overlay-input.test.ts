import { describe, expect, test } from "bun:test";

import { handleHistoryOverlayInput } from "@/app-shell/use-history-overlay-input";
import type { HistoryProgress } from "@kunai/storage";

function history(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "tmdb:1:1:2",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 2,
    positionSeconds: 120,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-06-22T00:00:00.000Z",
    createdAt: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("handleHistoryOverlayInput", () => {
  test("queues selected history rows through an awaited media action path", async () => {
    const calls: string[] = [];
    let resolveQueue: (() => void) | undefined;
    const queueSettled = new Promise<void>((resolve) => {
      resolveQueue = resolve;
    });
    const container = {
      queueService: {
        enqueueMediaItem: async () => {
          calls.push("queue-start");
          await queueSettled;
          calls.push("queue-finished");
        },
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      listService: { addToWatchlist: () => {} },
      followedTitleRepository: { upsert: () => {} },
      notificationService: { listActive: () => [] },
      stateManager: { dispatch: () => {} },
      historyRepository: { upsertProgress: () => {} },
    };

    const result = handleHistoryOverlayInput(
      "q",
      {},
      {
        container: container as never,
        historyView: { flatRows: [{ titleId: "tmdb:1" }] },
        historySelections: [{ titleId: "tmdb:1", entry: history() }],
        historyPickerContext: {},
        selectedIndex: 0,
        setHistoryTypeFilter: () => {},
        setHistoryTab: () => {},
        setSelectedIndex: () => {},
        setOverlayStatus: (status) => calls.push(`status:${status}`),
        onRedraw: () => calls.push("redraw"),
      },
    );

    expect(result).toBe("handled");
    expect(calls).toEqual(["queue-start"]);

    resolveQueue?.();
    await queueSettled;
    await Promise.resolve();

    expect(calls).toEqual([
      "queue-start",
      "queue-finished",
      "status:Queued from history",
      "redraw",
    ]);
  });
});
