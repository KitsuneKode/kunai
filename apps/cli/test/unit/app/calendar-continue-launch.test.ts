import { expect, test } from "bun:test";

import { resolveCalendarContinueSelection } from "@/app/calendar-continue-launch";
import type { SearchResult } from "@/domain/types";
import { ContinueWatchingService } from "@/services/continuation/ContinueWatchingService";
import type { HistoryProgress } from "@kunai/storage";

function makeRepo() {
  const rows = new Map<string, HistoryProgress[]>();
  return {
    listRecent: (limit: number) =>
      [...rows.values()]
        .flat()
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit),
    listByTitle: (titleId: string) => rows.get(titleId) ?? [],
    listLatestByTitle: () =>
      [...rows.values()].flat().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    upsertProgress: (input: {
      title: { id: string; kind: "series"; title: string };
      episode: { season: number; episode: number };
      positionSeconds: number;
      durationSeconds: number;
      completed: boolean;
      updatedAt: string;
    }) => {
      const entry: HistoryProgress = {
        key: "k",
        titleId: input.title.id,
        title: input.title.title,
        mediaKind: "series",
        season: input.episode.season,
        episode: input.episode.episode,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        completed: input.completed,
        providerId: "vidking",
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
      };
      rows.set(input.title.id, [entry]);
    },
  };
}

test("calendar continue-ready selection uses continueSourcePreference like History", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo as never);
  const result: SearchResult = {
    id: "tmdb:1",
    type: "series",
    title: "Demo",
    year: "2026",
    overview: "",
    posterPath: null,
    calendar: {
      source: "tmdb",
      titleId: "tmdb:1",
      title: "Demo",
      contentKind: "series",
      season: 1,
      episode: 4,
      releaseAt: "2026-01-03T00:00:00.000Z",
      releasePrecision: "date",
      releaseStatus: "released",
      providerConfirmed: false,
      reason: "airing-today",
      dayKey: "2026-01-03",
      continuation: {
        state: "next-up",
        badge: "1 new",
        playable: true,
        targetTitleId: "tmdb:1",
        season: 1,
        episode: 4,
      },
      display: {
        time: null,
        statusLabel: "new today",
        episodeCode: "S01E04",
        groupLabel: "FRI 3",
      },
    },
  };

  const selection = resolveCalendarContinueSelection(
    {
      continueWatchingService: service,
      historyRepository: repo as never,
      releaseProgressCache: {
        getByTitleIds: () =>
          new Map([
            [
              "tmdb:1",
              {
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
                checkedAt: "2026-01-03T00:00:00.000Z",
                nextCheckAt: "2026-01-03T02:00:00.000Z",
                staleAfterAt: "2026-01-04T00:00:00.000Z",
                sourceFingerprint: "fp",
                errorCount: 0,
              },
            ],
          ]),
      },
      offlineTitlePolicies: { listByTitleIds: () => [] },
      offlineAssetService: { listNextReadyByTitleCursors: () => [] },
      config: { continueSourcePreference: "stream" },
      diagnosticsService: { record: () => {} },
    } as never,
    result,
  );

  expect(selection?.targetEpisode).toMatchObject({ season: 1, episode: 4, reason: "new-episode" });
  expect(selection?.localJobId).toBeUndefined();
});
