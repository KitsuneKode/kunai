import { describe, expect, test } from "bun:test";

import {
  canAdvanceIntoRecommendation,
  canAutoContinueIntoRecommendation,
  isYoutubeSafeRecommendationId,
} from "@/app/playback/playback-postplay-policy";
import { isYoutubeCatalogId } from "@/services/youtube/YoutubeRecommendationService";

describe("youtube recommendation advance gates", () => {
  test("isYoutubeSafeRecommendationId accepts youtube catalog prefixes", () => {
    expect(isYoutubeSafeRecommendationId("youtube:abc")).toBe(true);
    expect(isYoutubeSafeRecommendationId("youtube-playlist:PL1")).toBe(true);
    expect(isYoutubeSafeRecommendationId("youtube-channel:UC1")).toBe(true);
    expect(isYoutubeSafeRecommendationId("1399")).toBe(false);
  });

  test("canAdvanceIntoRecommendation blocks TMDB ids in youtube mode", () => {
    expect(canAdvanceIntoRecommendation({ shellMode: "youtube", recommendationId: "1399" })).toBe(
      false,
    );
    expect(
      canAdvanceIntoRecommendation({
        shellMode: "youtube",
        recommendationId: "youtube:dQw4w9WgXcQ",
      }),
    ).toBe(true);
    expect(canAdvanceIntoRecommendation({ shellMode: "series", recommendationId: "1399" })).toBe(
      true,
    );
  });

  test("canAutoContinueIntoRecommendation stays mode-agnostic for load policy", () => {
    expect(
      canAutoContinueIntoRecommendation({
        sessionMode: "autoplay-chain",
        hasNextEpisode: false,
        endReason: "eof",
        autoplayPaused: false,
        autoplaySessionPaused: false,
        aborted: false,
        hasQueuedNext: false,
        autoplayRecommendationsEnabled: true,
      }),
    ).toBe(true);
  });

  test("isYoutubeCatalogId matches parser kinds", () => {
    expect(isYoutubeCatalogId("youtube:abc")).toBe(true);
    expect(isYoutubeCatalogId("youtube-channel:UC")).toBe(true);
    expect(isYoutubeCatalogId("42")).toBe(false);
  });
});
