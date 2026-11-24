import { describe, expect, mock, test } from "bun:test";

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

  test("a stand-in calendar answer is never persisted and is reused only briefly", async () => {
    let now = NOW;
    let calls = 0;
    const store = new MemoryScheduleCache();
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: async () => {
          calls += 1;
          return [
            {
              source: "tmdb",
              titleId: "1489",
              titleName: "Jimmy Kimmel Live",
              type: "series",
              releaseAt: "2026-05-08T23:35:00.000Z",
              releasePrecision: "timestamp",
              status: "unknown",
              via: "TVmaze",
            },
          ];
        },
      }),
      () => now,
      store,
    );
    await service.loadReleaseWindow("series", 7);
    await service.loadReleaseWindow("series", 7);
    expect(calls).toBe(1);
    expect(store.size).toBe(0);
    now += 61_000;
    await service.loadReleaseWindow("series", 7);
    expect(calls).toBe(2);
  });

  test("one caller leaving does not cancel the shared request another caller waits on", async () => {
    let loadSignal: AbortSignal | undefined;
    let finish: ((items: never[]) => void) | undefined;
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: (_mode, _window, signal) => {
          loadSignal = signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      }),
      () => NOW,
    );
    const leaving = new AbortController();
    const first = service
      .loadReleaseWindow("series", 7, leaving.signal)
      .catch((error: Error) => error);
    const second = service.loadReleaseWindow("series", 7);
    leaving.abort();
    expect(await first).toBeInstanceOf(Error);
    // The shared request keeps running for the caller still waiting.
    expect(loadSignal?.aborted).toBe(false);
    finish?.([]);
    await expect(second).resolves.toEqual([]);
  });

  test("the shared request is cancelled once its last waiter leaves", async () => {
    let loadSignal: AbortSignal | undefined;
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: (_mode, _window, signal) => {
          loadSignal = signal;
          return new Promise(() => {});
        },
      }),
      () => NOW,
    );
    const a = new AbortController();
    const b = new AbortController();
    // Capture outcomes now: each caller's promise rejects the moment it aborts.
    const first = service.loadReleaseWindow("anime", 7, a.signal).catch((error: Error) => error);
    const second = service.loadReleaseWindow("anime", 7, b.signal).catch((error: Error) => error);
    a.abort();
    expect(loadSignal?.aborted).toBe(false);
    b.abort();
    expect(loadSignal?.aborted).toBe(true);
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toBeInstanceOf(Error);
  });

  test("a caller arriving after every waiter left starts a fresh request", async () => {
    let loads = 0;
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: () => {
          loads += 1;
          return loads === 1 ? new Promise(() => {}) : Promise.resolve([]);
        },
      }),
      () => NOW,
    );
    const leaving = new AbortController();
    const first = service.loadReleaseWindow("series", 7, leaving.signal).catch(() => "left");
    leaving.abort();
    expect(await first).toBe("left");
    // The cancelled request is still settling; a new caller must not join it.
    await expect(service.loadReleaseWindow("series", 7)).resolves.toEqual([]);
    expect(loads).toBe(2);
  });

  test("a request cancelled by clearCache never repopulates the cache", async () => {
    let loads = 0;
    let finish: ((items: never[]) => void) | undefined;
    const service = new CatalogScheduleService(
      createLoaders({
        releasingToday: () => {
          loads += 1;
          return loads === 1
            ? new Promise((resolve) => {
                finish = resolve;
              })
            : Promise.resolve([]);
        },
      }),
      () => NOW,
    );
    const pending = service.loadReleaseWindow("anime", 7).catch(() => "cancelled");
    service.clearCache();
    // The aborted loader still resolves (a caught abort can yield partial data).
    finish?.([]);
    await pending;
    await service.loadReleaseWindow("anime", 7);
    expect(loads).toBe(2);
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

  test("default AniList progress loader records latest release timestamp for ongoing anime", async () => {
    const releaseAt = new Date(1_715_395_200 * 1000).toISOString();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              Page: {
                media: [
                  {
                    id: 21,
                    episodes: null,
                    status: "RELEASING",
                    nextAiringEpisode: { episode: 29, airingAt: 1_716_000_000 },
                    airingSchedule: { nodes: [{ episode: 28, airingAt: 1_715_395_200 }] },
                    relations: { edges: [] },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    try {
      const service = new CatalogScheduleService(undefined, () => NOW);
      await service.prefetchAnimeReleaseProgressForTitles(["21"], new AbortController().signal);
      expect(service.peekAnimeReleaseProgress("21")).toMatchObject({
        latestAiredEpisode: 28,
        latestKnownReleaseAt: releaseAt,
        sourceFingerprint: `anilist:21:ongoing:29:1716000000:${releaseAt}`,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("default AniList progress loader records latest release timestamp for finished anime", async () => {
    const releaseAt = new Date(1_715_395_200 * 1000).toISOString();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              Page: {
                media: [
                  {
                    id: 21,
                    episodes: 28,
                    status: "FINISHED",
                    nextAiringEpisode: null,
                    airingSchedule: { nodes: [{ episode: 28, airingAt: 1_715_395_200 }] },
                    relations: { edges: [] },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    try {
      const service = new CatalogScheduleService(undefined, () => NOW);
      await service.prefetchAnimeReleaseProgressForTitles(["21"], new AbortController().signal);
      expect(service.peekAnimeReleaseProgress("21")).toMatchObject({
        latestAiredEpisode: 28,
        latestKnownReleaseAt: releaseAt,
        sourceFingerprint: `anilist:21:finished:28:${releaseAt}`,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  get size(): number {
    return this.entries.size;
  }
}
