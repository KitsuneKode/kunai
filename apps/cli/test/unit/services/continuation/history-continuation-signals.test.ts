import { expect, test } from "bun:test";

import { continuationSignalsForHistoryEntry } from "@/services/continuation/history-continuation-signals";
import type { HistoryProgress } from "@kunai/storage";

function entry(over: Partial<HistoryProgress> & { titleId: string }): HistoryProgress {
  const { titleId, ...rest } = over;
  return {
    key: "k",
    mediaKind: "anime",
    title: "Demo",
    season: 1,
    episode: 8,
    positionSeconds: 1500,
    durationSeconds: 1500,
    completed: true,
    providerId: "allanime",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...rest,
    titleId,
  };
}

test("continuationSignalsForHistoryEntry does not fabricate next without release cache", () => {
  const signals = continuationSignalsForHistoryEntry({
    titleId: "native-1",
    entry: entry({ titleId: "native-1" }),
    nextRelease: null,
  });

  expect(signals.releaseProgress).toBeNull();
  expect(signals.nextRelease).toBeNull();
});

test("continuationSignalsForHistoryEntry skips optimistic next when catalog is complete", () => {
  const signals = continuationSignalsForHistoryEntry({
    titleId: "barakamon",
    entry: entry({ titleId: "barakamon", episode: 12 }),
    nextRelease: null,
    catalogBounds: { season: 1, latestEpisode: 12 },
  });
  expect(signals.releaseProgress).toBeNull();
  expect(signals.nextRelease).toBeNull();
});

test("continuationSignalsForHistoryEntry keeps cached release progress authoritative", () => {
  const signals = continuationSignalsForHistoryEntry({
    titleId: "tmdb:1",
    entry: entry({ titleId: "tmdb:1", episode: 3 }),
    nextRelease: { status: "released", season: 1, episode: 4, releaseAt: null },
    releaseProgress: {
      titleId: "tmdb:1",
      mediaKind: "series",
      source: "tmdb",
      title: "Demo",
      anchorSeason: 1,
      anchorEpisode: 3,
      latestAiredSeason: 1,
      latestAiredEpisode: 4,
      newEpisodeCount: 1,
      status: "new-episodes",
      checkedAt: "2026-01-01T00:00:00.000Z",
      nextCheckAt: "2026-01-02T00:00:00.000Z",
      staleAfterAt: "2026-01-03T00:00:00.000Z",
      sourceFingerprint: "fp",
      errorCount: 0,
    },
  });

  expect(signals.nextRelease).toMatchObject({ season: 1, episode: 4, released: true });
  expect(signals.releaseProgress).toEqual({ newEpisodeCount: 1, stale: expect.any(Boolean) });
});
