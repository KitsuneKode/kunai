import { describe, expect, test } from "bun:test";

import {
  planEpisodeQueue,
  planMediaQueuePlacement,
  type EpisodeQueueScope,
} from "@/domain/queue/QueuePlanner";

const current = { season: 1, episode: 4, name: "Four" };
const seasonEpisodes = [
  { season: 1, episode: 1 },
  { season: 1, episode: 5, name: "Five" },
  { season: 1, episode: 6, name: "Six" },
  { season: 2, episode: 1, name: "Wrong season" },
  { season: 1, episode: 5, name: "Duplicate Five" },
];

describe("QueuePlanner", () => {
  test("selects next N episodes from the current season without duplicates", () => {
    const scope: EpisodeQueueScope = { type: "next-n", count: 4 };

    const result = planEpisodeQueue({
      scope,
      currentEpisode: current,
      seasonEpisodes,
      nextEpisode: { season: 1, episode: 5 },
    });

    expect(result.episodes).toEqual([
      { season: 1, episode: 5, name: "Five" },
      { season: 1, episode: 6, name: "Six" },
    ]);
    expect(result.reason).toBe("current-season-window");
  });

  test("uses explicit next episode when a season catalog is not available", () => {
    const result = planEpisodeQueue({
      scope: { type: "next-n", count: 3 },
      currentEpisode: current,
      nextEpisode: { season: 1, episode: 5, name: "Five" },
      seasonEpisodes: null,
    });

    expect(result.episodes).toEqual([{ season: 1, episode: 5, name: "Five" }]);
    expect(result.reason).toBe("explicit-next");
  });

  test("dedupes manual selections in first-seen order", () => {
    const result = planEpisodeQueue({
      scope: {
        type: "manual-selection",
        episodes: [
          { season: 2, episode: 1 },
          { season: 2, episode: 1 },
          { season: 1, episode: 8 },
        ],
      },
      currentEpisode: current,
    });

    expect(result.episodes).toEqual([
      { season: 2, episode: 1 },
      { season: 1, episode: 8 },
    ]);
    expect(result.reason).toBe("manual-selection");
  });

  test("maps queue placements to stable priority bands", () => {
    expect(planMediaQueuePlacement("next")).toEqual({ priority: 100, bucket: "next" });
    expect(planMediaQueuePlacement("after-current-chain")).toEqual({
      priority: 50,
      bucket: "after-current-chain",
    });
    expect(planMediaQueuePlacement("end")).toEqual({ priority: 0, bucket: "end" });
  });
});
