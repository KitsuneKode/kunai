import { describe, expect, test } from "bun:test";

import type { RootHistorySelection } from "@/app-shell/root-history-bridge";
import { handleHistoryOverlayInput } from "@/app-shell/use-history-overlay-input";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
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

const dualProjection: ContinuationProjection = {
  kind: "offline-ready",
  titleId: "tmdb:1",
  title: "Example",
  season: 1,
  episode: 3,
  sourceEntry: history({ completed: true }),
  primaryAction: { kind: "play-local", season: 1, episode: 3, jobId: "job-3" },
  secondaryActions: [{ kind: "select-online", season: 1, episode: 3 }],
};

function baseCtx(overrides: Partial<Parameters<typeof handleHistoryOverlayInput>[2]> = {}) {
  const confirmations: Array<{ localJobId?: string }> = [];
  return {
    ctx: {
      container: {} as never,
      historyView: { flatRows: [{ titleId: "tmdb:1", dualSourceAvailable: true }] },
      historySelections: [{ titleId: "tmdb:1", entry: history() }],
      historyPickerContext: { projections: new Map([["tmdb:1", dualProjection]]) },
      selectedIndex: 0,
      sourceChoiceTitleId: null,
      sourcePreference: "auto" as const,
      setSourceChoiceTitleId: () => {},
      setHistoryTypeFilter: () => {},
      setHistoryTab: () => {},
      setSelectedIndex: () => {},
      setOverlayStatus: () => {},
      onRedraw: () => {},
      onConfirmSelection: (selection: RootHistorySelection | null) => {
        confirmations.push({ localJobId: selection?.localJobId });
      },
      ...overrides,
    },
    confirmations,
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
        historyView: { flatRows: [{ titleId: "tmdb:1", dualSourceAvailable: false }] },
        historySelections: [{ titleId: "tmdb:1", entry: history() }],
        historyPickerContext: {},
        selectedIndex: 0,
        sourceChoiceTitleId: null,
        sourcePreference: "auto",
        setSourceChoiceTitleId: () => {},
        setHistoryTypeFilter: () => {},
        setHistoryTab: () => {},
        setSelectedIndex: () => {},
        setOverlayStatus: (status) => calls.push(`status:${status}`),
        onRedraw: () => calls.push("redraw"),
        onConfirmSelection: () => {},
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

  test("auto preference confirms local when dual sources exist", () => {
    const { ctx, confirmations } = baseCtx();
    expect(handleHistoryOverlayInput("", { return: true }, ctx)).toBe("handled");
    expect(confirmations[0]?.localJobId).toBe("job-3");
  });

  test("stream preference confirms online target", () => {
    const { ctx, confirmations } = baseCtx({ sourcePreference: "stream" });
    expect(handleHistoryOverlayInput("", { return: true }, ctx)).toBe("handled");
    expect(confirmations[0]?.localJobId).toBeUndefined();
  });

  test("ask preference prompts before confirming", () => {
    const statuses: Array<string | null> = [];
    const { ctx } = baseCtx({
      sourcePreference: "ask",
      setOverlayStatus: (status) => statuses.push(status),
    });
    expect(handleHistoryOverlayInput("", { return: true }, ctx)).toBe("handled");
    expect(statuses[0]).toContain("Choose source");
  });

  test("l override forces local on dual-source rows", () => {
    const { ctx, confirmations } = baseCtx({ sourcePreference: "stream" });
    expect(handleHistoryOverlayInput("l", {}, ctx)).toBe("handled");
    expect(confirmations[0]?.localJobId).toBe("job-3");
  });

  test("s override forces stream on dual-source rows", () => {
    const { ctx, confirmations } = baseCtx({ sourcePreference: "local" });
    expect(handleHistoryOverlayInput("s", {}, ctx)).toBe("handled");
    expect(confirmations[0]?.localJobId).toBeUndefined();
  });

  test("Tab cycles history tabs forward and Shift+Tab reverses", () => {
    const tabs: string[] = [];
    const { ctx } = baseCtx({
      setHistoryTab: (update) => {
        tabs.push(update("continue"));
      },
    });

    expect(handleHistoryOverlayInput("", { tab: true }, ctx)).toBe("handled");
    expect(handleHistoryOverlayInput("", { tab: true, shift: true }, ctx)).toBe("handled");
    expect(tabs).toEqual(["completed", "all"]);
  });

  test("→ cycles type filter forward and ← reverses", () => {
    const filters: string[] = [];
    const { ctx } = baseCtx({
      setHistoryTypeFilter: (update) => {
        filters.push(update("all"));
      },
      setSelectedIndex: () => {},
    });

    expect(handleHistoryOverlayInput("", { rightArrow: true }, ctx)).toBe("handled");
    expect(handleHistoryOverlayInput("", { leftArrow: true }, ctx)).toBe("handled");
    expect(filters).toEqual(["anime", "movie"]);
  });
});
