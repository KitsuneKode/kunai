import { describe, expect, test } from "bun:test";

import {
  getNotificationDetailsPending,
  stageNotificationDetailsItem,
  stageNotificationPlaybackIntent,
  subscribeNotificationDetails,
  takeNotificationDetailsItem,
  takeNotificationPlaybackIntent,
} from "@/app-shell/root-overlay-bridge";

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
});
