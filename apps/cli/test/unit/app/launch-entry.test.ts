import { describe, expect, test } from "bun:test";

import { selectContinueHistoryEntry, titleFromHistorySelection } from "@/app/launch-entry";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

function history(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Demo Show",
    type: "series",
    season: 1,
    episode: 2,
    timestamp: 600,
    duration: 1800,
    completed: false,
    provider: "vidsrc",
    watchedAt: "2026-05-14T08:00:00.000Z",
    ...patch,
  };
}

describe("launch entry helpers", () => {
  test("selectContinueHistoryEntry picks the newest unfinished local history target", () => {
    const selected = selectContinueHistoryEntry({
      "finished-newer": history({
        title: "Finished",
        completed: true,
        watchedAt: "2026-05-14T10:00:00.000Z",
      }),
      "unfinished-older": history({
        title: "Older",
        watchedAt: "2026-05-14T07:00:00.000Z",
      }),
      "unfinished-newer": history({
        title: "Newer",
        watchedAt: "2026-05-14T09:00:00.000Z",
      }),
    });

    expect(selected).toEqual({
      titleId: "unfinished-newer",
      entry: expect.objectContaining({ title: "Newer" }),
    });
  });

  test("titleFromHistorySelection rebuilds a playback title without provider work", () => {
    expect(
      titleFromHistorySelection({
        titleId: "tmdb:1399",
        entry: history({ title: "Game of Thrones", type: "series" }),
      }),
    ).toEqual({
      id: "tmdb:1399",
      type: "series",
      name: "Game of Thrones",
    });
  });
});
