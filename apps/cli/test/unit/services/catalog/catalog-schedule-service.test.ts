import { describe, expect, test } from "bun:test";

import {
  buildLocalDayWindow,
  CatalogScheduleService,
  CatalogScheduleRequestError,
  classifyReleaseStatus,
  type CatalogScheduleLoaders,
} from "@/services/catalog/CatalogScheduleService";

const NOW = Date.parse("2026-05-08T12:00:00.000Z");

describe("CatalogScheduleService", () => {
  test("normalizes date and timestamp release status deterministically", () => {
    expect(classifyReleaseStatus("2026-05-07", "date", NOW)).toBe("released"); // strictly past
    // date-only precision: an episode dated *today* stays upcoming until the day ends
    expect(classifyReleaseStatus("2026-05-08", "date", NOW)).toBe("upcoming");
    expect(classifyReleaseStatus("2026-05-09", "date", NOW)).toBe("upcoming");
    expect(classifyReleaseStatus("2026-05-08T12:00:00.000Z", "timestamp", NOW)).toBe("released");
    expect(classifyReleaseStatus("2026-05-08T13:00:00.000Z", "timestamp", NOW)).toBe("upcoming");
    expect(classifyReleaseStatus(null, "unknown", NOW)).toBe("unknown");
  });

  test("caches next release by source title season and episode", async () => {
    let calls = 0;
    const service = new CatalogScheduleService(
      createLoaders({
        nextRelease: async (input) => {
          calls += 1;
          return {
            source: input.source,
            titleId: input.titleId,
            titleName: input.titleName,
            type: input.type,
            season: input.season,
            episode: input.episode,
            releaseAt: "2026-05-09",
            releasePrecision: "date",
            status: "unknown",
          };
        },
      }),
      () => NOW,
    );

    const first = await service.getNextRelease({
      source: "tmdb",
      titleId: "1",
      titleName: "Demo",
      type: "series",
      season: 1,
      episode: 2,
    });
    const second = await service.getNextRelease({
      source: "tmdb",
      titleId: "1",
      titleName: "Demo",
      type: "series",
      season: 1,
      episode: 2,
    });
    const differentEpisode = await service.getNextRelease({
      source: "tmdb",
      titleId: "1",
      titleName: "Demo",
      type: "series",
      season: 1,
      episode: 3,
    });

    expect(first?.status).toBe("upcoming");
    expect(second).toEqual(first);
    expect(differentEpisode?.episode).toBe(3);
    expect(calls).toBe(2);
  });

  test("reuses persisted schedule cache across service instances", async () => {
    let calls = 0;
    const store = new MemoryScheduleCache();
    const first = new CatalogScheduleService(
      createLoaders({
        nextRelease: async (input) => {
          calls += 1;
          return {
            source: input.source,
            titleId: input.titleId,
            titleName: input.titleName,
            type: input.type,
            season: input.season,
            episode: input.episode,
            releaseAt: "2026-05-09",
            releasePrecision: "date",
            status: "unknown",
          };
        },
      }),
      () => NOW,
      store,
    );
    const second = new CatalogScheduleService(createLoaders({}), () => NOW, store);

    await first.getNextRelease({
      source: "tmdb",
      titleId: "1",
      titleName: "Demo",
      type: "series",
      season: 1,
      episode: 2,
    });
    const cached = await second.getNextRelease({
      source: "tmdb",
      titleId: "1",
      titleName: "Demo",
      type: "series",
      season: 1,
      episode: 2,
    });

    expect(cached?.status).toBe("upcoming");
    expect(calls).toBe(1);
  });

  test("dedupes in-flight releasing-today loads per mode and day", async () => {
    let calls = 0;
    let releaseLoad!: () => void;
    const loadStarted = Promise.withResolvers<void>();
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: async () => {
          calls += 1;
          loadStarted.resolve();
          await new Promise<void>((resolve) => {
            releaseLoad = resolve;
          });
          return [
            {
              source: "anilist",
              titleId: "10",
              titleName: "Airing",
              type: "anime",
              episode: 5,
              releaseAt: "2026-05-08T13:00:00.000Z",
              releasePrecision: "timestamp",
              status: "unknown",
            },
          ];
        },
      }),
      () => NOW,
    );

    const first = service.loadReleasingToday("anime");
    await loadStarted.promise;
    const second = service.loadReleasingToday("anime");
    releaseLoad();

    expect(await first).toEqual(await second);
    expect(calls).toBe(1);
  });

  test("loads and caches wider release windows by mode, date, and day count", async () => {
    let calls = 0;
    let lastWindowDays = 0;
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: async (_mode, window) => {
          calls += 1;
          lastWindowDays = Math.round(
            (window.end.getTime() - window.start.getTime()) / (24 * 60 * 60 * 1000),
          );
          return [
            {
              source: "anilist",
              titleId: "10",
              titleName: "Weekly Airing",
              type: "anime",
              episode: 5,
              releaseAt: "2026-05-10T13:00:00.000Z",
              releasePrecision: "timestamp",
              status: "unknown",
            },
          ];
        },
      }),
      () => NOW,
    );

    const first = await service.loadReleaseWindow("anime", 7);
    const second = await service.loadReleaseWindow("anime", 7);

    expect(first).toEqual(second);
    expect(first[0]?.status).toBe("upcoming");
    expect(lastWindowDays).toBe(7);
    expect(calls).toBe(1);
  });

  test("loads one cached TMDB season progress payload instead of per-episode requests", async () => {
    let calls = 0;
    const service = new CatalogScheduleService(
      createLoaders({
        seriesProgress: async (input) => {
          calls += 1;
          return {
            latestAiredSeason: input.season,
            latestAiredEpisode: 4,
            latestKnownReleaseAt: "2026-05-08",
            sourceFingerprint: `tmdb:${input.titleId}:${input.season}:4`,
          };
        },
      }),
      () => NOW,
    );

    const first = await service.getSeriesReleaseProgress({
      source: "tmdb",
      titleId: "9",
      titleName: "Series",
      type: "series",
      season: 1,
    });
    const second = await service.getSeriesReleaseProgress({
      source: "tmdb",
      titleId: "9",
      titleName: "Series",
      type: "series",
      season: 1,
    });

    expect(first?.latestAiredEpisode).toBe(4);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  test("dedupes overlapping AniList progress batches and retains finished-series totals", async () => {
    let calls = 0;
    let releaseLoad!: () => void;
    const loadStarted = Promise.withResolvers<void>();
    const service = new CatalogScheduleService(
      createLoaders({
        animeProgress: async () => {
          calls += 1;
          loadStarted.resolve();
          await new Promise<void>((resolve) => {
            releaseLoad = resolve;
          });
          return new Map([
            [
              "21",
              {
                latestAiredEpisode: 28,
                latestKnownReleaseAt: "2026-05-08T00:00:00.000Z",
                sourceFingerprint: "anilist:21:finished:28",
              },
            ],
          ]);
        },
      }),
      () => NOW,
    );

    const first = service.prefetchAnimeReleaseProgressForTitles(
      ["21"],
      new AbortController().signal,
    );
    await loadStarted.promise;
    const second = service.prefetchAnimeReleaseProgressForTitles(
      ["21"],
      new AbortController().signal,
    );
    releaseLoad();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(service.peekAnimeReleaseProgress("21")?.latestAiredEpisode).toBe(28);
  });

  test("propagates typed transient catalog failures so reconciliation can back off", async () => {
    const service = new CatalogScheduleService(
      createLoaders({
        seriesProgress: async () => {
          throw new CatalogScheduleRequestError("rate-limited", "catalog rate limited");
        },
      }),
      () => NOW,
    );

    await expect(
      service.getSeriesReleaseProgress({
        source: "tmdb",
        titleId: "9",
        titleName: "Series",
        type: "series",
        season: 1,
      }),
    ).rejects.toMatchObject({ failureClass: "rate-limited" });
  });

  test("builds local day windows with stable date keys", () => {
    expect(buildLocalDayWindow(NOW).dateKey).toBe("2026-05-08");
  });
});

function createLoaders(overrides: Partial<CatalogScheduleLoaders>): CatalogScheduleLoaders {
  return {
    nextRelease: async () => null,
    releasingToday: async () => [],
    ...overrides,
  };
}

class MemoryScheduleCache {
  private readonly entries = new Map<string, { payloadJson: string; expiresAt: string }>();

  get(key: string, now = new Date()): { payloadJson: string } | undefined {
    const entry = this.entries.get(key);
    if (!entry || Date.parse(entry.expiresAt) <= now.getTime()) return undefined;
    return { payloadJson: entry.payloadJson };
  }

  set(key: string, payloadJson: string, options: { expiresAt: string }): void {
    this.entries.set(key, { payloadJson, expiresAt: options.expiresAt });
  }
}
