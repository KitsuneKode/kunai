import { describe, expect, test } from "bun:test";

import {
  clearNotificationPlaybackIntent,
  getNotificationDetailsPending,
  getNotificationPlaybackPending,
  openNotificationsOverlay,
  stageNotificationDetailsItem,
  stageNotificationPlaybackIntent,
  subscribeNotificationDetails,
  subscribeNotificationPlayback,
  takeNotificationDetailsItem,
  takeNotificationPlaybackIntent,
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

describe("root-overlay-bridge notification intents", () => {
  test("playback intent round-trips once", () => {
    stageNotificationPlaybackIntent({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 2 },
    });
    expect(takeNotificationPlaybackIntent()?.title.name).toBe("Example");
    expect(takeNotificationPlaybackIntent()).toBeNull();
  });

  test("playback intent notifies subscribers, matching the details intent", () => {
    // The two intents behaved differently: details notified, playback did not,
    // so consuming the playback intent depended on how the inbox was opened.
    let pending = false;
    const unsubscribe = subscribeNotificationPlayback(() => {
      pending = getNotificationPlaybackPending();
    });

    stageNotificationPlaybackIntent({
      title: { id: "tmdb:2", type: "series", name: "Notified" },
    });
    expect(pending).toBe(true);

    unsubscribe();
    expect(takeNotificationPlaybackIntent()?.title.name).toBe("Notified");
  });

  test("a stranded intent is dropped on clear, not replayed later", () => {
    // Reproduces the wrong-title bug: an inbox opened by direct dispatch strands
    // an intent nobody reads, which then fired against the next session.
    stageNotificationPlaybackIntent({
      title: { id: "tmdb:stranded", type: "series", name: "Stranded" },
    });
    expect(getNotificationPlaybackPending()).toBe(true);

    clearNotificationPlaybackIntent();

    expect(getNotificationPlaybackPending()).toBe(false);
    expect(takeNotificationPlaybackIntent()).toBeNull();
  });

  test("clearing on open still lets the palette route read after close", () => {
    // Ordering contract: the inbox clears on open, then the user stages, then
    // openNotificationsOverlay reads after close. Clearing on *close* instead
    // would break the one path that works today.
    clearNotificationPlaybackIntent();
    stageNotificationPlaybackIntent({
      title: { id: "tmdb:3", type: "series", name: "Survives" },
    });
    expect(takeNotificationPlaybackIntent()?.title.name).toBe("Survives");
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

  test("openNotificationsOverlay returns playback intent but leaves details for browse-shell", async () => {
    stageNotificationPlaybackIntent({
      title: { id: "tmdb:1", type: "series", name: "Playback Target" },
      episode: { season: 1, episode: 1 },
    });
    stageNotificationDetailsItem({
      mediaKind: "series",
      titleId: "tmdb:2",
      title: "Details Target",
    });

    const container = createOverlayContainer();
    const resultPromise = openNotificationsOverlay(container);
    await Promise.resolve();
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    const result = await resultPromise;

    expect(result.playback?.title.name).toBe("Playback Target");
    expect(getNotificationDetailsPending()).toBe(true);
    expect(takeNotificationDetailsItem()?.title).toBe("Details Target");
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
