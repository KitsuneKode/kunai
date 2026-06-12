import { describe, expect, test } from "bun:test";

import {
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesProvider,
  type RecentPlaybackStreamRecord,
} from "@/app/recent-playback-stream";

const stream = { url: "https://example.test/stream.m3u8" } as never;

describe("recent playback stream", () => {
  test("keys streams by title and 1-based episode identity", () => {
    expect(recentPlaybackStreamKey("tmdb:1396", { season: 2, episode: 7 })).toBe("tmdb:1396:2:7");
  });

  test("matches a normal stream only for the selected and resolved provider", () => {
    const recent: RecentPlaybackStreamRecord = {
      stream,
      selectedProviderId: "vidking",
      resolvedProviderId: "vidking",
      provenance: "fresh",
    };

    expect(recentPlaybackStreamMatchesProvider(recent, "vidking")).toBe(true);
    expect(recentPlaybackStreamMatchesProvider(recent, "rivestream")).toBe(false);
  });

  test("matches fallback streams by the effective resolved provider", () => {
    const recent: RecentPlaybackStreamRecord = {
      stream,
      selectedProviderId: "vidking",
      resolvedProviderId: "rivestream",
      provenance: "fallback",
    };

    expect(recentPlaybackStreamMatchesProvider(recent, "rivestream")).toBe(true);
    expect(recentPlaybackStreamMatchesProvider(recent, "vidking")).toBe(false);
  });
});
