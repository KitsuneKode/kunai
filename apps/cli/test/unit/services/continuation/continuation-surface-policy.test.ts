import { describe, expect, test } from "bun:test";

import { classifyHistoryBucket } from "@/domain/continuation/history-bucket";
import { reconcileContinueHistory } from "@/domain/continuation/history-reconciliation";
import { projectContinuation } from "@/services/continuation/continuation-engine";
import {
  projectContinuationSurface,
  type ContinuationSurfaceDecision,
} from "@/services/continuation/continuation-surface-policy";
import type { HistoryProgress } from "@kunai/storage";

function entry(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "tmdb:1",
    title: "Demo",
    mediaKind: "series",
    season: 1,
    episode: 5,
    positionSeconds: 1_400,
    durationSeconds: 1_400,
    completed: true,
    providerId: "vidking",
    updatedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

function expectSurface(
  decision: ContinuationSurfaceDecision,
  expected: ContinuationSurfaceDecision,
) {
  expect(decision).toEqual(expected);
}

describe("continuation surface policy — Continue and History agree", () => {
  test("finished series without release evidence is up to date in completed, not optimistic E+1", () => {
    const row = entry({ season: 2, episode: 3, completed: true });

    const surface = projectContinuationSurface({
      titleId: "tmdb:1",
      entry: row,
    });
    expectSurface(surface, {
      state: "up-to-date",
      historyBucket: "completed",
      actionLabel: "Open",
    });

    const engine = projectContinuation({ titleId: "tmdb:1", rows: [row] });
    expect(engine.state).toBe("up-to-date");

    const reconcile = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", row]],
    });
    expect(reconcile.kind).toBe("up-to-date");
    expect(reconcile).not.toMatchObject({ episode: 4 });

    expect(classifyHistoryBucket({ entry: row, release: null })).toBe("completed");
  });

  test("unfinished exact episode is Continue", () => {
    const row = entry({
      episode: 6,
      completed: false,
      positionSeconds: 420,
      durationSeconds: 1_400,
    });

    const surface = projectContinuationSurface({
      titleId: "tmdb:1",
      entry: row,
    });
    expectSurface(surface, {
      state: "resume",
      historyBucket: "continue",
      actionLabel: "Continue",
      target: { season: 1, episode: 6 },
    });
  });

  test("confirmed released next episode is Play next", () => {
    const row = entry({
      episode: 5,
      completed: true,
      updatedAt: "2026-05-20T00:00:00.000Z",
    });

    const surface = projectContinuationSurface({
      titleId: "tmdb:1",
      entry: row,
      nextRelease: { season: 1, episode: 6, released: true },
      releaseSignal: {
        status: "new-episodes",
        newEpisodeCount: 1,
        // Aired before last watch → backlog Continue, not New episodes.
        latestKnownReleaseAt: "2026-04-01T00:00:00.000Z",
      },
    });
    expectSurface(surface, {
      state: "next",
      historyBucket: "continue",
      actionLabel: "Play next",
      target: { season: 1, episode: 6 },
    });
  });

  test("freshly aired confirmed release lands in new-episodes with Play next", () => {
    const row = entry({
      episode: 8,
      completed: true,
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const surface = projectContinuationSurface({
      titleId: "tmdb:1",
      entry: row,
      nextRelease: { season: 1, episode: 9, released: true },
      releaseProgress: { newEpisodeCount: 1 },
      releaseSignal: {
        status: "new-episodes",
        newEpisodeCount: 1,
        latestKnownReleaseAt: "2026-05-08T00:00:00.000Z",
      },
    });
    expectSurface(surface, {
      state: "new-episodes",
      historyBucket: "new-episodes",
      actionLabel: "Play next",
      target: { season: 1, episode: 9 },
    });
  });

  test("offline-ready next episode is Play local", () => {
    const row = entry({ episode: 3, completed: true });

    const surface = projectContinuationSurface({
      titleId: "tmdb:1",
      entry: row,
      offline: {
        enrolled: true,
        readyNextEpisodes: [{ season: 1, episode: 4, jobId: "job-4" }],
      },
    });
    expectSurface(surface, {
      state: "next",
      historyBucket: "continue",
      actionLabel: "Play local",
      target: { season: 1, episode: 4 },
    });
  });

  test("upcoming-only release is up to date in completed", () => {
    const row = entry({ episode: 12, completed: true });

    const surface = projectContinuationSurface({
      titleId: "tmdb:1",
      entry: row,
      nextRelease: {
        season: 1,
        episode: 13,
        released: false,
        availableAt: "2026-06-01T00:00:00.000Z",
      },
      releaseSignal: { status: "upcoming", newEpisodeCount: 0 },
    });
    expectSurface(surface, {
      state: "upcoming",
      historyBucket: "completed",
      actionLabel: "Open",
      target: { season: 1, episode: 13 },
    });
  });

  test("empty history is empty", () => {
    expectSurface(projectContinuationSurface({ titleId: "tmdb:1", entry: null }), {
      state: "empty",
      historyBucket: "completed",
      actionLabel: "Open",
    });
  });
});
