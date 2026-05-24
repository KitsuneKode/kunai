import { describe, expect, test } from "bun:test";

import {
  buildRootHistorySelection,
  describeHistoryReturnLoopDetail,
  formatNewSinceEpisodeLabel,
  releaseProgressToContinueHistoryRelease,
} from "@/app-shell/root-history-bridge";
import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

function seriesEntry(partial: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Test Anime",
    type: "series",
    season: 1,
    episode: 5,
    timestamp: 1200,
    duration: 1400,
    watchedAt: new Date().toISOString(),
    completed: true,
    provider: "allanime",
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
