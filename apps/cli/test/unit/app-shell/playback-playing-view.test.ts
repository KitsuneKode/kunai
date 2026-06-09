import { describe, expect, test } from "bun:test";

import {
  buildPlaybackPlayingRailView,
  parseEpisodeTag,
  resolveNextEpisodeThumbUrl,
  resolveSeriesPosterUrl,
} from "@/app-shell/playback-playing-view";
import type { TitleDetail } from "@/domain/catalog/title-detail";

describe("playback-playing-view", () => {
  test("parseEpisodeTag reads SxxExx labels", () => {
    expect(parseEpisodeTag("S01E05")).toEqual({ season: 1, episode: 5 });
    expect(parseEpisodeTag("s2e12")).toEqual({ season: 2, episode: 12 });
    expect(parseEpisodeTag(undefined)).toBeUndefined();
  });

  test("resolveNextEpisodeThumbUrl looks up merged artwork", () => {
    const detail: TitleDetail = {
      id: "1",
      type: "series",
      title: "Demo",
      artwork: {
        episodeThumbnails: {
          "1.5": "https://example.com/ep5.jpg",
        },
      },
    };
    expect(resolveNextEpisodeThumbUrl(detail, "S01E05")).toBe("https://example.com/ep5.jpg");
    expect(resolveNextEpisodeThumbUrl(detail, "S02E01")).toBeUndefined();
  });

  test("resolveSeriesPosterUrl prefers catalog poster", () => {
    const detail: TitleDetail = {
      id: "1",
      type: "series",
      title: "Demo",
      artwork: { poster: "https://example.com/poster.jpg" },
    };
    expect(resolveSeriesPosterUrl(detail, "https://fallback.jpg")).toBe(
      "https://example.com/poster.jpg",
    );
    expect(resolveSeriesPosterUrl(undefined, "https://fallback.jpg")).toBe("https://fallback.jpg");
  });

  test("buildPlaybackPlayingRailView assembles facts and up next", () => {
    const view = buildPlaybackPlayingRailView({
      title: "Study Group",
      titleDetail: {
        id: "1",
        type: "series",
        title: "Study Group",
        year: "2026",
        genres: ["Comedy"],
        status: "airing",
        episodeCount: 12,
        synopsis: "A long synopsis that should still be present.",
        artwork: { poster: "https://example.com/poster.jpg" },
      },
      posterUrl: "https://fallback.jpg",
      upNextLabel: "S01E03",
      nextEpisodeLabel: "S01E03",
      currentSeason: 1,
      isSeries: true,
    });

    expect(view.seriesPosterUrl).toBe("https://example.com/poster.jpg");
    expect(view.facts.map((fact) => fact.label)).toEqual(
      expect.arrayContaining(["year", "genre", "season", "status", "episodes"]),
    );
    expect(view.upNext).toEqual({
      label: "S01E03",
      meta: "next S01E03",
    });
    expect(view.synopsis).toContain("synopsis");
  });
});
