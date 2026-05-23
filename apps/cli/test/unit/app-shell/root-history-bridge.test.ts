import { describe, expect, test } from "bun:test";

import {
  buildRootHistorySelection,
  describeHistoryReturnLoopDetail,
  formatNewSinceEpisodeLabel,
} from "@/app-shell/root-history-bridge";
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
});
