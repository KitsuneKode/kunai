import { describe, expect, test } from "bun:test";

import {
  isRecentPlaybackStreamFresh,
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesProvider,
  restoreRecentPlaybackStream,
  type RecentPlaybackStreamRecord,
} from "@/app/playback/recent-playback-stream";
import { MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS } from "@/domain/playback/in-memory-stream-replay-policy";
import type { StreamInfo } from "@/domain/types";

const stream = { url: "https://example.test/stream.m3u8", headers: {} } as StreamInfo;

describe("recent playback stream", () => {
  test("restores verified local provenance with its exact trust source", () => {
    const localPlaybackSource = {
      kind: "local" as const,
      jobId: "job-1",
      titleId: "title-1",
      titleName: "Offline episode",
      mediaKind: "series" as const,
      providerId: "vidking",
      season: 1,
      episode: 2,
      filePath: "/media/episode-2.mkv",
    };
    const recent: RecentPlaybackStreamRecord = {
      stream,
      episode: { season: 1, episode: 2 },
      selectedProviderId: "vidking",
      resolvedProviderId: "vidking",
      provenance: "local",
      localPlaybackSource,
    };

    expect(restoreRecentPlaybackStream(recent)).toEqual({
      stream,
      resolvedProviderId: "vidking",
      provenance: "local",
      localPlaybackSource,
    });
  });

  test("keys streams by title and 1-based episode identity", () => {
    expect(recentPlaybackStreamKey("tmdb:1396", { season: 2, episode: 7 })).toBe("tmdb:1396:2:7");
  });

  test("does not reuse a recent stream for a different provider-native episode at the same UI index", () => {
    const nativeZero = {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "0" },
    };
    const nativeOne = {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "1" },
    };
    const recent = {
      stream,
      episode: nativeZero,
      selectedProviderId: "allanime",
      resolvedProviderId: "allanime",
      provenance: "fresh" as const,
    };

    expect(recentPlaybackStreamKey("anilist:1", nativeZero)).not.toBe(
      recentPlaybackStreamKey("anilist:1", nativeOne),
    );
    expect(recentPlaybackStreamMatchesProvider(recent, "allanime", nativeOne)).toBe(false);
  });

  test("matches a normal stream only for the selected and resolved provider", () => {
    const recent: RecentPlaybackStreamRecord = {
      stream,
      episode: { season: 1, episode: 2 },
      selectedProviderId: "vidking",
      resolvedProviderId: "vidking",
      provenance: "fresh",
    };

    expect(recentPlaybackStreamMatchesProvider(recent, "vidking", recent.episode)).toBe(true);
    expect(recentPlaybackStreamMatchesProvider(recent, "rivestream", recent.episode)).toBe(false);
  });

  test("matches fallback streams by the effective resolved provider", () => {
    const recent: RecentPlaybackStreamRecord = {
      stream,
      episode: { season: 1, episode: 2 },
      selectedProviderId: "vidking",
      resolvedProviderId: "rivestream",
      provenance: "fallback",
    };

    expect(recentPlaybackStreamMatchesProvider(recent, "rivestream", recent.episode)).toBe(true);
    expect(recentPlaybackStreamMatchesProvider(recent, "vidking", recent.episode)).toBe(false);
  });

  test("isRecentPlaybackStreamFresh exempts local provenance regardless of age", () => {
    const recent: RecentPlaybackStreamRecord = {
      stream: { ...stream, timestamp: 0 },
      episode: { season: 1, episode: 2 },
      selectedProviderId: "vidking",
      resolvedProviderId: "vidking",
      provenance: "local",
      localPlaybackSource: {
        kind: "local",
        jobId: "job-1",
        titleId: "title-1",
        titleName: "Offline episode",
        mediaKind: "series",
        providerId: "vidking",
        season: 1,
        episode: 2,
        filePath: "/media/episode-2.mkv",
      },
    };

    expect(isRecentPlaybackStreamFresh(recent, 1_700_000_000_000)).toBe(true);
  });

  test("isRecentPlaybackStreamFresh rejects stale non-local streams", () => {
    const now = 1_700_000_000_000;
    const fresh: RecentPlaybackStreamRecord = {
      stream: { ...stream, timestamp: now - 1_000 },
      episode: { season: 1, episode: 2 },
      selectedProviderId: "vidking",
      resolvedProviderId: "vidking",
      provenance: "prefetch",
    };
    const stale: RecentPlaybackStreamRecord = {
      ...fresh,
      stream: { ...stream, timestamp: now - MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS - 1 },
    };

    expect(isRecentPlaybackStreamFresh(fresh, now)).toBe(true);
    expect(isRecentPlaybackStreamFresh(stale, now)).toBe(false);
  });
});
