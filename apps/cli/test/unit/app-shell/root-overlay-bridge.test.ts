import { describe, expect, test } from "bun:test";

import {
  getNotificationDetailsPending,
  openNotificationsOverlay,
  stageNotificationDetailsItem,
  stageNotificationPlaybackIntent,
  subscribeNotificationDetails,
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
    // Wait until the overlay is actually open before closing — a single
    // microtask is not enough if OPEN_OVERLAY is deferred.
    await Bun.sleep(0);
    expect(container.stateManager.getState().activeModals.at(-1)?.type).toBe("notifications");
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    const result = await resultPromise;

    expect(result.playback?.title.name).toBe("Playback Target");
    expect(getNotificationDetailsPending()).toBe(true);
    expect(takeNotificationDetailsItem()?.title).toBe("Details Target");
  });
});
