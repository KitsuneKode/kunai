import { expect, test } from "bun:test";

import {
  classifyHistoryBucket,
  type HistoryReleaseSignal,
} from "@/domain/continuation/history-bucket";
import type { HistoryProgress } from "@kunai/storage";

const WATCHED_AT = "2026-05-01T00:00:00.000Z";

function seriesEntry(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    titleId: "t1",
    title: "Series AB",
    mediaKind: "anime",
    providerId: "allanime",
    season: 1,
    episode: 8,
    absoluteEpisode: 8,
    positionSeconds: 1400,
    durationSeconds: 1400,
    completed: true,
    updatedAt: WATCHED_AT,
    ...(overrides as object),
  } as HistoryProgress;
}

function movieEntry(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return seriesEntry({ mediaKind: "movie", episode: undefined, ...overrides } as object);
}

const signal = (s: Partial<HistoryReleaseSignal>): HistoryReleaseSignal => ({
  status: "unknown",
  newEpisodeCount: 0,
  ...s,
});

test("in-progress series → continue", () => {
  const entry = seriesEntry({ completed: false, positionSeconds: 300, durationSeconds: 1400 });
  expect(classifyHistoryBucket({ entry, release: null })).toBe("continue");
});

test("in-progress movie → continue", () => {
  const entry = movieEntry({ completed: false, positionSeconds: 300, durationSeconds: 6000 });
  expect(classifyHistoryBucket({ entry, release: null })).toBe("continue");
});

test("finished movie → completed", () => {
  expect(classifyHistoryBucket({ entry: movieEntry(), release: null })).toBe("completed");
});

test("finished series with a freshly aired new episode → new-episodes", () => {
  const entry = seriesEntry();
  const release = signal({
    status: "new-episodes",
    newEpisodeCount: 1,
    latestKnownReleaseAt: "2026-05-08T00:00:00.000Z", // aired AFTER last watch
  });
  expect(classifyHistoryBucket({ entry, release })).toBe("new-episodes");
});

test("finished series, aired delta that is NOT fresh (backlog) → continue", () => {
  const entry = seriesEntry({ episode: 10 });
  const release = signal({
    status: "new-episodes",
    newEpisodeCount: 14,
    latestKnownReleaseAt: "2026-04-01T00:00:00.000Z", // aired BEFORE last watch (CD case)
  });
  expect(classifyHistoryBucket({ entry, release })).toBe("continue");
});

test("finished series, caught-up → completed (regression: was wrongly 'new')", () => {
  const release = signal({ status: "caught-up", newEpisodeCount: 0 });
  expect(classifyHistoryBucket({ entry: seriesEntry(), release })).toBe("completed");
});

test("finished series, upcoming → completed", () => {
  const release = signal({ status: "upcoming", newEpisodeCount: 0 });
  expect(classifyHistoryBucket({ entry: seriesEntry(), release })).toBe("completed");
});

test("finished series, unknown / no signal → continue (don't mislabel half-watched as done)", () => {
  // Finishing ONE episode with no aired-total/release evidence must not claim the
  // whole series is completed — the reported bug. Keep it in continue.
  expect(
    classifyHistoryBucket({ entry: seriesEntry(), release: signal({ status: "unknown" }) }),
  ).toBe("continue");
  expect(classifyHistoryBucket({ entry: seriesEntry(), release: null })).toBe("continue");
});

test("finished a mid-series episode (ep 8 of 24 aired) → continue, not completed", () => {
  const entry = seriesEntry({ episode: 8, absoluteEpisode: 8 });
  const release = signal({ status: "unknown", latestAiredEpisode: 24 });
  expect(classifyHistoryBucket({ entry, release })).toBe("continue");
});

test("finished the latest aired episode (ep 24 of 24) → completed", () => {
  const entry = seriesEntry({ episode: 24, absoluteEpisode: 24 });
  const release = signal({ status: "unknown", latestAiredEpisode: 24 });
  expect(classifyHistoryBucket({ entry, release })).toBe("completed");
});

test("finished series, caught-up but a downloaded next is ready → continue", () => {
  const release = signal({ status: "caught-up", newEpisodeCount: 0 });
  expect(classifyHistoryBucket({ entry: seriesEntry(), release, hasKnownNextToPlay: true })).toBe(
    "continue",
  );
});

test("new-episodes delta with unknown release time → continue (don't flood New)", () => {
  const release = signal({
    status: "new-episodes",
    newEpisodeCount: 2,
    latestKnownReleaseAt: null,
  });
  expect(classifyHistoryBucket({ entry: seriesEntry(), release })).toBe("continue");
});

test("finished series at known catalog end → completed even without release cache", () => {
  const entry = seriesEntry({ episode: 12, completed: true });
  expect(
    classifyHistoryBucket({
      entry,
      release: null,
      catalogBounds: { season: 1, latestEpisode: 12 },
    }),
  ).toBe("completed");
});
