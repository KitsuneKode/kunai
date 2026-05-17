import { describe, expect, test } from "bun:test";

import { reconcileContinueHistory } from "@/domain/continuation/history-reconciliation";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

function history(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Demo",
    type: "series",
    season: 1,
    episode: 5,
    timestamp: 1_800,
    duration: 1_800,
    completed: true,
    provider: "vidking",
    watchedAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

describe("history reconciliation", () => {
  test("prefers unfinished progress over a newer completed episode", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [
        ["tmdb:1", history({ episode: 6, watchedAt: "2026-05-12T00:00:00.000Z" })],
        [
          "tmdb:1",
          history({
            episode: 5,
            completed: false,
            timestamp: 600,
            watchedAt: "2026-05-11T00:00:00.000Z",
          }),
        ],
      ],
    });

    expect(decision).toMatchObject({
      kind: "resume",
      titleId: "tmdb:1",
      entry: expect.objectContaining({ episode: 5, completed: false }),
    });
  });

  test("surfaces a released next episode without mutating completed history", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", history({ episode: 5, completed: true })]],
      nextRelease: {
        season: 1,
        episode: 6,
        status: "released",
        releaseAt: "2026-05-17",
      },
    });

    expect(decision).toEqual({
      kind: "new-episode",
      titleId: "tmdb:1",
      titleName: "Demo",
      season: 1,
      episode: 6,
      previousCompleted: expect.objectContaining({ episode: 5 }),
      releaseAt: "2026-05-17",
    });
  });

  test("keeps completed titles calm when the next episode is only scheduled", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", history({ episode: 5, completed: true })]],
      nextRelease: {
        season: 1,
        episode: 6,
        status: "upcoming",
        releaseAt: "2026-05-24",
      },
    });

    expect(decision).toMatchObject({
      kind: "up-to-date",
      nextRelease: { episode: 6, status: "upcoming" },
    });
  });
});
