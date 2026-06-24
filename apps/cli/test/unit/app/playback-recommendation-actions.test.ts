import { describe, expect, test } from "bun:test";

import type { PlaybackRecommendationRailItem } from "@/app-shell/types";
import {
  enqueuePostPlaybackRecommendation,
  recommendationRailItemToMediaItem,
} from "@/app/playback/playback-recommendation-actions";

describe("playback recommendation actions", () => {
  const item: PlaybackRecommendationRailItem = {
    id: "tmdb:42",
    title: "Example Show",
    type: "series",
    sourceId: "tmdb",
    year: "2026",
  };

  test("materializes recommendation rail items as media action identities", () => {
    expect(recommendationRailItemToMediaItem(item)).toEqual({
      mediaKind: "series",
      sourceId: "tmdb",
      titleId: "tmdb:42",
      title: "Example Show",
    });
  });

  test("queues through an awaited action path before showing feedback", async () => {
    const calls: string[] = [];
    let resolveQueue: (() => void) | undefined;
    const queueFinished = new Promise<void>((resolve) => {
      resolveQueue = resolve;
    });
    const container = {
      queueService: {
        enqueueMediaItem: async () => {
          calls.push("queue-start");
          await queueFinished;
          calls.push("queue-finished");
        },
      },
      stateManager: {
        dispatch: () => {
          calls.push("feedback");
        },
      },
    };

    const queued = enqueuePostPlaybackRecommendation(container as never, item);

    expect(queued).toBeInstanceOf(Promise);
    expect(calls).toEqual(["queue-start"]);

    resolveQueue?.();
    await queued;

    expect(calls).toEqual(["queue-start", "queue-finished", "feedback"]);
  });
});
