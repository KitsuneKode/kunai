import { describe, expect, test } from "bun:test";

import { buildPostPlayView } from "@/app-shell/post-play-view";
import {
  postPlaybackRecommendationItemsToRailItems,
  seedPostPlaybackRecommendationItems,
} from "@/app/post-play/post-playback-recommendations";
import type { SearchResult } from "@/domain/types";

describe("post-play recommendation ready transition", () => {
  test("recommendation seed returns items when prefetch arrives after empty start", () => {
    expect(
      seedPostPlaybackRecommendationItems({
        enabled: true,
        currentTitle: "Current",
        prefetchedItems: null,
      }),
    ).toEqual([]);

    const items = seedPostPlaybackRecommendationItems({
      enabled: true,
      currentTitle: "Current",
      prefetchedItems: [
        {
          id: "tmdb:9",
          type: "series",
          title: "Neighbor",
          posterPath: "/p.jpg",
        } as SearchResult,
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Neighbor");
  });

  test("post-play discovery cards keep posterUrl through ready transition", () => {
    const emptyView = buildPostPlayView({
      title: "Current",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [],
    });
    expect(emptyView.discovery).toEqual([]);

    const readyItems = postPlaybackRecommendationItemsToRailItems([
      {
        id: "tmdb:9",
        type: "series",
        title: "Neighbor",
        posterPath: "/p.jpg",
      },
    ]);

    const readyView = buildPostPlayView({
      title: "Current",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: readyItems,
    });

    expect(readyView.discovery).toHaveLength(1);
    expect(readyView.discovery[0]?.title).toBe("Neighbor");
    expect(readyView.discovery[0]?.posterUrl).toBe("https://image.tmdb.org/t/p/w185/p.jpg");
  });
});
