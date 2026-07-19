import { describe, expect, test } from "bun:test";

import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { resolveNextUp } from "@/domain/playback/resolve-next-up";
import { planMediaQueuePlacement } from "@/domain/queue/QueuePlanner";
import type { QueueEntry } from "@kunai/storage";

const ep = { season: 1, episode: 2 };
const queueHead = {
  id: "q1",
  title: "Queued",
  mediaKind: "series",
  titleId: "t2",
} as unknown as QueueEntry;
const rec: MediaItemIdentity = { titleId: "t3", title: "Rec", mediaKind: "series" };

describe("resolveNextUp", () => {
  test("next episode wins over queue and rec", () => {
    expect(
      resolveNextUp({
        nextEpisode: ep,
        queueHead,
        topRecommendation: rec,
        seriesDone: false,
        autoplayRecommendations: true,
      }),
    ).toEqual({ kind: "episode", episode: ep });
  });

  test("queue head wins when no next episode", () => {
    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead,
        topRecommendation: rec,
        seriesDone: true,
        autoplayRecommendations: true,
      }),
    ).toEqual({ kind: "queue", entry: queueHead });
  });

  test("recommendation only when series done AND setting on AND queue empty", () => {
    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: rec,
        seriesDone: true,
        autoplayRecommendations: true,
      }),
    ).toEqual({ kind: "recommendation", item: rec });

    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: rec,
        seriesDone: true,
        autoplayRecommendations: false,
      }),
    ).toBeNull();

    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: rec,
        seriesDone: false,
        autoplayRecommendations: true,
      }),
    ).toBeNull();
  });

  test("a 'play next' queue head interrupts the episode chain", () => {
    const playNextHead = {
      ...queueHead,
      priority: planMediaQueuePlacement("next").priority,
    } as unknown as QueueEntry;

    expect(
      resolveNextUp({
        nextEpisode: ep,
        queueHead: playNextHead,
        topRecommendation: rec,
        seriesDone: false,
        autoplayRecommendations: true,
      }),
    ).toEqual({ kind: "queue", entry: playNextHead });
  });

  test("watchlist-refilled and end-placed items wait for the episode chain", () => {
    for (const placement of ["after-current-chain", "end"] as const) {
      const head = {
        ...queueHead,
        priority: planMediaQueuePlacement(placement).priority,
      } as unknown as QueueEntry;

      expect(
        resolveNextUp({
          nextEpisode: ep,
          queueHead: head,
          topRecommendation: rec,
          seriesDone: false,
          autoplayRecommendations: true,
        }),
      ).toEqual({ kind: "episode", episode: ep });
    }
  });

  test("null when nothing is available", () => {
    expect(
      resolveNextUp({
        nextEpisode: null,
        queueHead: undefined,
        topRecommendation: null,
        seriesDone: true,
        autoplayRecommendations: true,
      }),
    ).toBeNull();
  });
});
