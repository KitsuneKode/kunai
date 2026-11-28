import { describe, expect, test } from "bun:test";

import type { RootHistorySelection } from "@/app-shell/root-history-bridge";
import {
  handleHistoryOverlayInput,
  historyConfirmationTargetIds,
} from "@/app-shell/use-history-overlay-input";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import type { HistoryProgress } from "@kunai/storage";

import { createConfirmStripHarness } from "./history-confirm-test-utils";

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
  const confirm = createConfirmStripHarness();
  return {
    ctx: {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
      confirmState: confirm.state,
      transitionConfirm: confirm.transition,
      confirmationVisibleIds: ["title:tmdb:1", "episode:tmdb:1:1:2"],
      onHistoryMutated: () => {},
      onConfirmSelection: (selection: RootHistorySelection | null) => {
        confirmations.push({ localJobId: selection?.localJobId });
      },
      filterQuery: "",
      filterFocused: false,
      setFilterFocused: () => {},
      ...overrides,
    },
    confirmations,
  };
}

describe("history confirmation targets", () => {
  test("indexes selections by title id once", () => {
    const ids = historyConfirmationTargetIds(
      [{ titleId: "tmdb:1" }, { titleId: "tmdb:2" }],
      [
        { titleId: "tmdb:1", entry: { key: "tmdb:1:1:2" } },
        { titleId: "tmdb:1", entry: { key: "later" } },
      ],
    );
    expect(ids).toEqual(["title:tmdb:1", "episode:tmdb:1:1:2", "title:tmdb:2"]);
  });
});

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
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        confirmState: createConfirmStripHarness().state,
        transitionConfirm: createConfirmStripHarness().transition,
        confirmationVisibleIds: ["title:tmdb:1", "episode:tmdb:1:1:2"],
        // SAFETY: the partial test double is intentionally narrowed to the input context contract.
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
        onHistoryMutated: () => {},
        onConfirmSelection: () => {},
        filterQuery: "",
        filterFocused: false,
        setFilterFocused: () => {},
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
    // Both start from "all": forward lands on the first facet, back wraps to the last.
    expect(filters).toEqual(["anime", "youtube"]);
  });

  test("a snapshot error leaves the strip failed and does not delete", () => {
    const confirm = createConfirmStripHarness();
    confirm.transition({
      type: "arm",
      targetId: "title:tmdb:1",
      label: "all history for Demo",
      verb: "delete",
      visibleIds: ["title:tmdb:1"],
    });
    const deleted: string[] = [];
    const { ctx } = baseCtx({
      confirmState: confirm.state,
      transitionConfirm: confirm.transition,
      // SAFETY: partial container — this test only calls captureHistory and deleteTitle.
      container: {
        sessionUndo: {
          captureHistory: () => {
            throw new Error("snapshot failed");
          },
        },
        historyRepository: {
          deleteTitle: (id: string) => {
            deleted.push(id);
          },
          deleteProgressByKey: () => {},
        },
      } as never,
    });

    expect(handleHistoryOverlayInput("y", {}, ctx)).toBe("handled");
    expect(deleted).toEqual([]);
    expect(confirm.state).toMatchObject({ kind: "failed", message: "snapshot failed" });
  });

  test("refreshes History when the delete succeeded but undo recording failed", () => {
    const confirm = createConfirmStripHarness();
    confirm.transition({
      type: "arm",
      targetId: "title:tmdb:1",
      label: "all history for Demo",
      verb: "delete",
      visibleIds: ["title:tmdb:1"],
    });
    const statuses: Array<string | null> = [];
    let mutated = 0;
    const { ctx } = baseCtx({
      confirmState: confirm.state,
      transitionConfirm: confirm.transition,
      setOverlayStatus: (status) => {
        statuses.push(status);
      },
      onHistoryMutated: () => {
        mutated += 1;
      },
      // SAFETY: partial container — this test only calls capture, delete, and recordHistoryChange.
      container: {
        sessionUndo: {
          captureHistory: () => ({ titles: 1 }),
          recordHistoryChange: () => {
            throw new Error("undo log full");
          },
        },
        historyRepository: {
          deleteTitle: () => {},
          deleteProgressByKey: () => {},
        },
      } as never,
    });

    expect(handleHistoryOverlayInput("y", {}, ctx)).toBe("handled");
    expect(mutated).toBe(1);
    expect(confirm.state.kind).toBe("idle");
    expect(statuses.at(-1)).toBe("Removed all history for Demo. Undo is unavailable");
  });

  test("title removal status does not repeat the scope phrase", () => {
    const confirm = createConfirmStripHarness();
    confirm.transition({
      type: "arm",
      targetId: "title:tmdb:1",
      label: "all history for Demo",
      verb: "delete",
      visibleIds: ["title:tmdb:1"],
    });
    const statuses: Array<string | null> = [];
    const { ctx } = baseCtx({
      confirmState: confirm.state,
      transitionConfirm: confirm.transition,
      setOverlayStatus: (status) => {
        statuses.push(status);
      },
      // SAFETY: partial container — this test only calls deleteTitle.
      container: {
        historyRepository: { deleteTitle: () => {}, deleteProgressByKey: () => {} },
      } as never,
    });

    handleHistoryOverlayInput("y", {}, ctx);
    expect(statuses.at(-1)).toBe("Removed all history for Demo");
  });

  test("a deletion error stays until Escape", () => {
    const confirm = createConfirmStripHarness();
    confirm.transition({
      type: "arm",
      targetId: "episode:tmdb:1:1:2",
      label: "Demo · S01E02",
      verb: "delete",
      visibleIds: ["episode:tmdb:1:1:2"],
    });
    confirm.transition({ type: "confirm" });
    confirm.transition({ type: "fail", message: "database locked" });
    const { ctx } = baseCtx({
      confirmState: confirm.state,
      transitionConfirm: confirm.transition,
    });

    expect(handleHistoryOverlayInput("", { downArrow: true }, ctx)).toBe("handled");
    expect(confirm.state).toMatchObject({ kind: "failed", message: "database locked" });
    expect(handleHistoryOverlayInput("", { escape: true }, ctx)).toBe("handled");
    expect(confirm.state.kind).toBe("idle");
  });

  test("Ctrl+Y does not delete history", () => {
    const confirm = createConfirmStripHarness();
    confirm.transition({
      type: "arm",
      targetId: "title:tmdb:1",
      label: "all history for Demo",
      verb: "delete",
      visibleIds: ["title:tmdb:1"],
    });
    let deleted = 0;
    const { ctx } = baseCtx({
      confirmState: confirm.state,
      transitionConfirm: confirm.transition,
      // SAFETY: partial container — this test only calls deleteTitle.
      container: {
        historyRepository: {
          deleteTitle: () => {
            deleted += 1;
          },
          deleteProgressByKey: () => {},
        },
      } as never,
    });

    expect(handleHistoryOverlayInput("y", { ctrl: true }, ctx)).toBe("handled");
    expect(deleted).toBe(0);
    expect(confirm.state.kind).toBe("armed");
  });
});
