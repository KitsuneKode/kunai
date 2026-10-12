import { describe, expect, test } from "bun:test";

import { cancelRootOverlay } from "@/app-shell/cancel-root-overlay";
import {
  getNotificationDetailsPending,
  hasPendingNotificationSelection,
  openNotificationsOverlay,
  resolveNotificationSelection,
  stageNotificationDetailsItem,
  subscribeNotificationDetails,
  takeNotificationDetailsItem,
  waitForNotificationSelection,
  type NotificationOverlayOutcome,
} from "@/app-shell/root-overlay-bridge";
import type { Container } from "@/container";

function createOverlayContainer(): Container {
  let activeModals: Array<{ type: string }> = [];
  const listeners = new Set<(state: { activeModals: typeof activeModals }) => void>();

  const stateManager = {
    getState: () => ({ activeModals }),
    dispatch: (event: { type: string; overlay?: { type: string } }) => {
      if (event.type === "OPEN_OVERLAY" && event.overlay) {
        activeModals = [...activeModals, event.overlay];
      }
      if (event.type === "REPLACE_TOP_OVERLAY" && event.overlay) {
        activeModals = [...activeModals.slice(0, -1), event.overlay];
      }
      if (event.type === "CLOSE_TOP_OVERLAY") {
        activeModals = activeModals.slice(0, -1);
      }
      for (const listener of listeners) {
        listener({ activeModals });
      }
    },
    subscribe: (listener: (state: { activeModals: typeof activeModals }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return { stateManager } as unknown as Container;
}

const playbackOutcome: NotificationOverlayOutcome = {
  kind: "playback",
  title: { id: "tmdb:1", type: "series", name: "Playback Target" },
  episode: { season: 1, episode: 1 },
};

describe("root-overlay-bridge notification selection", () => {
  test("playback outcome round-trips through the bridge", async () => {
    expect(hasPendingNotificationSelection()).toBe(false);
    const selection = waitForNotificationSelection();
    expect(hasPendingNotificationSelection()).toBe(true);

    resolveNotificationSelection(playbackOutcome);

    expect(hasPendingNotificationSelection()).toBe(false);
    await expect(selection).resolves.toEqual(playbackOutcome);
  });

  test("details outcome round-trips through the bridge", async () => {
    const outcome: NotificationOverlayOutcome = {
      kind: "details",
      item: {
        mediaKind: "series",
        titleId: "tmdb:9",
        title: "Details Target",
      },
    };
    const selection = waitForNotificationSelection();
    resolveNotificationSelection(outcome);
    await expect(selection).resolves.toEqual(outcome);
  });

  test("a null resolution releases the awaiter with no outcome", async () => {
    const selection = waitForNotificationSelection();
    resolveNotificationSelection(null);
    await expect(selection).resolves.toBeNull();
  });

  test("registering a new awaiter releases a leaked earlier one", async () => {
    const leaked = waitForNotificationSelection();
    const fresh = waitForNotificationSelection();

    await expect(leaked).resolves.toBeNull();
    expect(hasPendingNotificationSelection()).toBe(true);

    resolveNotificationSelection(playbackOutcome);
    await expect(fresh).resolves.toEqual(playbackOutcome);
  });

  test("cancelRootOverlay releases a pending inbox awaiter with null", async () => {
    const selection = waitForNotificationSelection();
    const container = createOverlayContainer();

    cancelRootOverlay({ type: "notifications" }, container.stateManager);

    await expect(selection).resolves.toBeNull();
    expect(hasPendingNotificationSelection()).toBe(false);
    expect(container.stateManager.getState().activeModals).toEqual([]);
  });

  test("details intent notifies subscribers and clears on take", () => {
    let pending = false;
    const unsubscribe = subscribeNotificationDetails(() => {
      pending = getNotificationDetailsPending();
    });

    stageNotificationDetailsItem({
      mediaKind: "series",
      titleId: "tmdb:9",
      title: "Details Target",
      season: 1,
      episode: 3,
    });

    expect(pending).toBe(true);
    expect(takeNotificationDetailsItem()?.title).toBe("Details Target");
    expect(getNotificationDetailsPending()).toBe(false);
    unsubscribe();
  });

  test("openNotificationsOverlay returns the row's outcome and leaves details staged", async () => {
    const container = createOverlayContainer();
    const resultPromise = openNotificationsOverlay(container);
    await Promise.resolve();

    stageNotificationDetailsItem({
      mediaKind: "series",
      titleId: "tmdb:2",
      title: "Details Target",
    });
    resolveNotificationSelection(playbackOutcome);
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });

    const result = await resultPromise;
    expect(result.outcome).toEqual(playbackOutcome);
    // The details item is consumed by browse-shell's subscriber, not the bridge.
    expect(getNotificationDetailsPending()).toBe(true);
    expect(takeNotificationDetailsItem()?.title).toBe("Details Target");
  });

  test("openNotificationsOverlay resolves null when the inbox closes with no selection", async () => {
    const container = createOverlayContainer();
    const resultPromise = openNotificationsOverlay(container);
    await Promise.resolve();

    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    const result = await resultPromise;
    expect(result.outcome).toBeNull();
    expect(hasPendingNotificationSelection()).toBe(false);
  });

  test("a selection resolved before close survives the close-time null release", async () => {
    // Ordering contract: the row executor resolves the bridge, THEN closes the
    // overlay. openNotificationsOverlay's post-close null release must not
    // overwrite an outcome that already landed.
    const container = createOverlayContainer();
    const resultPromise = openNotificationsOverlay(container);
    await Promise.resolve();

    resolveNotificationSelection(playbackOutcome);
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });

    await expect(resultPromise).resolves.toEqual({ outcome: playbackOutcome });
  });

  test("openRootOwnedOverlay pushes a different overlay type on top of an open modal", async () => {
    const { openRootOwnedOverlay } = await import("@/app-shell/root-overlay-bridge");
    const container = createOverlayContainer();
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: { type: "notifications" },
    });

    const opened = openRootOwnedOverlay(container, { type: "help" });
    await Promise.resolve();
    expect(container.stateManager.getState().activeModals.map((m) => m.type)).toEqual([
      "notifications",
      "help",
    ]);
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    await opened;
    expect(container.stateManager.getState().activeModals.map((m) => m.type)).toEqual([
      "notifications",
    ]);
  });
});
