import { describe, expect, test } from "bun:test";

import { loadCatalogProgress } from "@/services/release-reconciliation/catalog-progress";
import type { ReleaseReconciliationCandidate } from "@/services/release-reconciliation/types";

function candidate(
  catalogId: string,
  source: "anilist" | "tmdb" = "anilist",
): ReleaseReconciliationCandidate {
  return {
    titleId: `${source}:${catalogId}`,
    mediaKind: source === "anilist" ? "anime" : "series",
    source,
    catalogId,
    title: `Show ${catalogId}`,
    season: 1,
    episode: 2,
    anchorSeason: 1,
    anchorEpisode: 2,
  };
}

describe("loadCatalogProgress", () => {
  test("batches AniList progress in at most two chunks of fifty", async () => {
    const calls: string[][] = [];
    const progress = await loadCatalogProgress(
      {
        prefetchAnimeReleaseProgressForTitles: async (ids) => {
          calls.push([...ids]);
        },
        peekAnimeReleaseProgress: (_id) => ({
          latestAiredEpisode: 7,
          nextAiringEpisode: 8,
          nextAiringAt: "2026-05-30T00:00:00.000Z",
          sourceFingerprint: "anilist:ongoing:8",
        }),
        getSeriesReleaseProgress: async () => null,
      },
      Array.from({ length: 130 }, (_, index) => candidate(String(index + 1))),
      new AbortController().signal,
    );

    expect(calls.map((batch) => batch.length)).toEqual([50, 50]);
    expect(progress).toHaveLength(100);
  });

  test("keeps finished AniList shows visible when no future airing episode exists", async () => {
    const progress = await loadCatalogProgress(
      {
        prefetchAnimeReleaseProgressForTitles: async () => {},
        peekAnimeReleaseProgress: () => ({
          latestAiredEpisode: 12,
          latestKnownReleaseAt: "2026-05-08T00:00:00.000Z",
          sourceFingerprint: "anilist:finished:12",
        }),
        getSeriesReleaseProgress: async () => null,
      },
      [candidate("42")],
      new AbortController().signal,
    );

    expect(progress[0]).toMatchObject({ latestAiredEpisode: 12 });
  });

  test("limits TMDB work to five season-level progress reads", async () => {
    const calls: string[] = [];
    const progress = await loadCatalogProgress(
      {
        prefetchAnimeReleaseProgressForTitles: async () => {},
        peekAnimeReleaseProgress: () => null,
        getSeriesReleaseProgress: async (input) => {
          calls.push(input.titleId);
          return {
            latestAiredSeason: input.season,
            latestAiredEpisode: 4,
            latestKnownReleaseAt: "2026-05-20",
            sourceFingerprint: `tmdb:${input.titleId}:4`,
          };
        },
      },
      Array.from({ length: 9 }, (_, index) => candidate(String(index + 1), "tmdb")),
      new AbortController().signal,
    );

    expect(calls).toEqual(["1", "2", "3", "4", "5"]);
    expect(progress).toHaveLength(5);
  });
});
