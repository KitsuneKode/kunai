import { describe, expect, test } from "bun:test";

import {
  catalogBoundsFromEpisodeCount,
  isAtOrPastCatalogEnd,
  optimisticNextEpisodeWithinBounds,
} from "@/domain/continuation/catalog-episode-bounds";
import { reconcileContinueHistory } from "@/domain/continuation/history-reconciliation";
import type { HistoryProgress } from "@kunai/storage";

function history(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "native-1",
    title: "Demo",
    mediaKind: "anime",
    season: 1,
    episode: 12,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
    providerId: "allanime",
    updatedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

describe("catalog episode bounds", () => {
  test("detects when the anchor reached the catalog end", () => {
    const bounds = catalogBoundsFromEpisodeCount(1, 12);
    expect(isAtOrPastCatalogEnd({ season: 1, episode: 12 }, bounds)).toBe(true);
    expect(optimisticNextEpisodeWithinBounds({ season: 1, episode: 12 }, bounds)).toBeNull();
  });

  test("still offers the next episode when the catalog has room", () => {
    const bounds = catalogBoundsFromEpisodeCount(1, 12);
    expect(optimisticNextEpisodeWithinBounds({ season: 1, episode: 8 }, bounds)).toEqual({
      season: 1,
      episode: 9,
    });
  });
});

describe("reconcileContinueHistory with catalog bounds", () => {
  test("does not fabricate a next episode when the series is finished", () => {
    const decision = reconcileContinueHistory({
      titleId: "native-1",
      entries: [["native-1", history({ episode: 12, completed: true })]],
      catalogBounds: catalogBoundsFromEpisodeCount(1, 12),
    });

    expect(decision).toMatchObject({ kind: "up-to-date" });
  });

  test("still advances when the catalog has a later episode", () => {
    const decision = reconcileContinueHistory({
      titleId: "native-1",
      entries: [["native-1", history({ episode: 8, completed: true })]],
      catalogBounds: catalogBoundsFromEpisodeCount(1, 12),
    });

    expect(decision).toMatchObject({ kind: "new-episode", episode: 9 });
  });
});
