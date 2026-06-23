import { describe, expect, test } from "bun:test";

import {
  buildRootHistorySelection,
  describeHistoryReturnLoopDetail,
  formatNewSinceEpisodeLabel,
  releaseProgressToContinueHistoryRelease,
} from "@/app-shell/root-history-bridge";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import type { HistoryProgress } from "@kunai/storage";

function seriesEntry(partial: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "x",
    title: "Test Anime",
    mediaKind: "series",
    season: 1,
    episode: 5,
    positionSeconds: 1200,
    durationSeconds: 1400,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    completed: true,
    providerId: "allanime",
    ...partial,
  };
}

describe("root history bridge return loop", () => {
  test("formatNewSinceEpisodeLabel describes delta since last watched episode", () => {
    expect(formatNewSinceEpisodeLabel(5, 6)).toBe("new since E5");
    expect(formatNewSinceEpisodeLabel(5, 8)).toBe("3 new since E5");
    expect(formatNewSinceEpisodeLabel(8, 5)).toBeNull();
  });

  test("describeHistoryReturnLoopDetail prefers new-since copy for released next episodes", () => {
    const detail = describeHistoryReturnLoopDetail({
      entry: seriesEntry(),
      nextRelease: {
        status: "released",
        releaseAt: new Date().toISOString(),
        season: 1,
        episode: 6,
      },
    });
    expect(detail).toContain("new since E5");
    expect(detail).toContain("open next aired episode");
  });

  test("describeHistoryReturnLoopDetail names scheduled and unknown caught-up states", () => {
    const upcoming = describeHistoryReturnLoopDetail({
      entry: seriesEntry(),
      nextRelease: {
        status: "upcoming",
        releaseAt: "2026-06-15T10:00:00.000Z",
        season: 1,
        episode: 6,
      },
    });
    const unknown = describeHistoryReturnLoopDetail({
      entry: seriesEntry(),
      nextRelease: { status: "unknown", releaseAt: null },
    });

    expect(upcoming).toContain("caught up · next airs");
    expect(unknown).toBe("caught up · release unknown");
  });

  test("buildRootHistorySelection targets the next episode when a new release is available", () => {
    const selection = buildRootHistorySelection(
      { titleId: "anilist:1", entry: seriesEntry() },
      new Map([
        [
          "anilist:1",
          {
            status: "released",
            releaseAt: new Date().toISOString(),
            season: 1,
            episode: 6,
          },
        ],
      ]),
    );
    expect(selection.targetEpisode).toEqual({
      season: 1,
      episode: 6,
      reason: "new-episode",
    });
  });

  test("buildRootHistorySelection targets an offline-ready projection before release cache", () => {
    const entry = seriesEntry();
    const projection: ContinuationProjection = {
      titleId: "anilist:1",
      kind: "offline-ready",
      title: "Test Anime",
      badge: "3 new",
      season: 1,
      episode: 6,
      sourceEntry: entry,
      primaryAction: { kind: "play-local", season: 1, episode: 6, jobId: "job-6" },
      secondaryActions: [],
      freshness: "local",
    };
    const selection = buildRootHistorySelection(
      { titleId: "anilist:1", entry },
      undefined,
      new Map([["anilist:1", projection]]),
    );
    expect(selection.targetEpisode).toEqual({
      season: 1,
      episode: 6,
      reason: "offline-ready",
    });
    expect(selection.localJobId).toBe("job-6");
  });

  test("buildRootHistorySelection uses shared continuation next-up actions", () => {
    const entry = seriesEntry();
    const projection: ContinuationProjection = {
      titleId: "anilist:1",
      kind: "next-released",
      title: "Test Anime",
      badge: "next",
      detail: "next episode ready",
      season: 1,
      episode: 9,
      sourceEntry: entry,
      primaryAction: { kind: "select-online", season: 1, episode: 9 },
      secondaryActions: [],
      freshness: "cached",
    };
    const selection = buildRootHistorySelection(
      { titleId: "anilist:1", entry },
      undefined,
      new Map([["anilist:1", projection]]),
    );
    expect(selection.targetEpisode).toEqual({
      season: 1,
      episode: 9,
      reason: "new-episode",
    });
  });

  test("release projections target the first unwatched aired episode without altering history", () => {
    const release = releaseProgressToContinueHistoryRelease({
      titleId: "anilist:1",
      mediaKind: "anime",
      source: "anilist",
      title: "Test Anime",
      anchorSeason: 1,
      anchorEpisode: 5,
      latestAiredSeason: 1,
      latestAiredEpisode: 8,
      newEpisodeCount: 3,
      status: "new-episodes",
      checkedAt: "2026-05-23T10:00:00.000Z",
      nextCheckAt: "2026-05-24T10:00:00.000Z",
      staleAfterAt: "2026-05-24T10:00:00.000Z",
      sourceFingerprint: "anime:8",
      errorCount: 0,
    });

    expect(release).toMatchObject({ status: "released", season: 1, episode: 6 });
  });
});
