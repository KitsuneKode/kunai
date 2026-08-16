import { describe, expect, test } from "bun:test";

import type { Container } from "@/container";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  resolveDownloadIntentItems,
  type DownloadConfirmationProfile,
} from "@/services/download/DownloadIntentService";

const SERIES_PROFILE: DownloadConfirmationProfile = {
  audioPreference: "original",
  subtitlePreference: "en",
  qualityPreference: "best",
  cacheArtwork: false,
  enrollKeepWatchingOffline: false,
  runwayTarget: 2,
  cleanupPolicy: { mode: "keep-last-watched", count: 1 },
};

describe("resolveDownloadIntentItems", () => {
  test("movie download intent is title-level", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "tmdb:movie:693134", type: "movie", name: "Dune: Part Two" },
        mediaKind: "movie",
      }),
    ).toEqual([{ kind: "title" }]);
  });

  test("a movie ignores any carried season and episode rather than persisting a slot", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "tmdb:1", type: "movie", name: "Movie" },
        mediaKind: "movie",
        season: 4,
        episode: 9,
      }),
    ).toEqual([{ kind: "title" }]);
  });

  test("an anime film is title-level even though its identity remains anime", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "anilist:181053", type: "movie", name: "Infinity Castle", isAnime: true },
        mediaKind: "anime",
        season: 1,
        episode: 1,
      }),
    ).toEqual([{ kind: "title" }]);
  });

  test("video download intent is title-level", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "yt:1", type: "series", name: "Trailer" },
        mediaKind: "video",
        season: 1,
        episode: 1,
      }),
    ).toEqual([{ kind: "title" }]);
  });

  test("series use the carried season/episode when present", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "tmdb:1", type: "series", name: "Show" },
        mediaKind: "series",
        season: 2,
        episode: 5,
      }),
    ).toEqual([{ kind: "episode", episode: { season: 2, episode: 5 } }]);
  });

  test("anime use the carried season/episode when present", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "anilist:1", type: "series", name: "Frieren" },
        mediaKind: "anime",
        season: 1,
        episode: 3,
      }),
    ).toEqual([{ kind: "episode", episode: { season: 1, episode: 3 } }]);
  });

  test("series without episode info fall back to the first episode", () => {
    expect(
      resolveDownloadIntentItems({
        title: { id: "tmdb:1", type: "series", name: "Show" },
        mediaKind: "series",
      }),
    ).toEqual([{ kind: "episode", episode: { season: 1, episode: 1 } }]);
  });

  test("episodic identity never comes from title.type", () => {
    // A movie carried on a "series"-shaped TitleInfo is still title-level.
    expect(
      resolveDownloadIntentItems({
        title: { id: "tmdb:1", type: "series", name: "Movie" },
        mediaKind: "movie",
        season: 1,
        episode: 1,
      }),
    ).toEqual([{ kind: "title" }]);
  });
});

describe("buildDefaultDownloadProfile", () => {
  test("derives audio/subtitle/quality from the active language profile", () => {
    const container = {
      config: {
        offlineArtworkCacheEnabled: true,
        downloadPath: "/dl",
        offlineDefaultRunwayTarget: 3,
      },
      stateManager: {
        getState: () => ({
          provider: "vidking",
          mode: "series",
          seriesLanguageProfile: { audio: "en", subtitle: "none", quality: "1080p" },
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
      },
    } as unknown as Container;

    expect(buildDefaultDownloadProfile(container)).toMatchObject({
      audioPreference: "en",
      subtitlePreference: "none",
      qualityPreference: "1080p",
      cacheArtwork: true,
      outputDirectory: "/dl",
      enrollKeepWatchingOffline: false,
      runwayTarget: 3,
      cleanupPolicy: { mode: "keep-last-watched", count: 1 },
    });
  });
});

describe("commitDownloadIntent", () => {
  test("blocks and surfaces feedback when downloads are ineligible", async () => {
    let enqueues = 0;
    const notes: string[] = [];
    const container = {
      downloadService: {
        getEnqueueEligibility: () => ({
          allowed: false,
          code: "downloads-disabled",
          reason: "Downloads are disabled.",
        }),
        enqueue: async () => {
          enqueues += 1;
          return { id: "job" };
        },
        processQueue: () => {},
      },
      diagnosticsService: { record: () => {} },
      stateManager: {
        getState: () => ({ provider: "vidking", mode: "series" }),
        dispatch: (action: { note?: string }) => {
          if (action.note) notes.push(action.note);
        },
      },
    } as unknown as Container;

    const result = await commitDownloadIntent(container, {
      title: { id: "tmdb:1", type: "series", name: "Show" },
      mediaKind: "series",
      items: [{ kind: "episode", episode: { season: 1, episode: 1 } }],
      profile: SERIES_PROFILE,
    });

    expect(result).toEqual({ status: "blocked", queuedCount: 0 });
    expect(enqueues).toBe(0);
    expect(notes).toEqual(["Download unavailable: Downloads are disabled."]);
  });

  test("enqueues every episode and persists the offline title policy", async () => {
    let enqueues = 0;
    let persistedTitleId: string | undefined;
    let processed = 0;
    const container = {
      config: { offlineDefaultRunwayTarget: 2 },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => {
          enqueues += 1;
          return { id: `job-${enqueues}` };
        },
        processQueue: () => {
          processed += 1;
        },
      },
      offlineTitlePolicies: {
        get: () => undefined,
        upsert: (input: { titleId: string }) => {
          persistedTitleId = input.titleId;
        },
      },
      offlineRunwayService: { enqueueEvaluation: () => {} },
      diagnosticsService: { record: () => {} },
      stateManager: {
        getState: () => ({ provider: "vidking", mode: "series" }),
        dispatch: () => {},
      },
    } as unknown as Container;

    const result = await commitDownloadIntent(container, {
      title: { id: "tmdb:7", type: "series", name: "Show" },
      mediaKind: "series",
      items: [
        { kind: "episode", episode: { season: 1, episode: 1 } },
        { kind: "episode", episode: { season: 1, episode: 2 } },
      ],
      profile: SERIES_PROFILE,
    });

    expect(result).toEqual({ status: "queued", queuedCount: 2 });
    expect(enqueues).toBe(2);
    expect(persistedTitleId).toBe("tmdb:7");
    expect(processed).toBe(1);
  });

  test("reports a partial batch when a later enqueue throws", async () => {
    let enqueues = 0;
    let persisted = 0;
    const container = {
      config: { offlineDefaultRunwayTarget: 2 },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => {
          enqueues += 1;
          if (enqueues === 2) throw new Error("rejected");
          return { id: "job-1" };
        },
        processQueue: () => {},
      },
      offlineTitlePolicies: {
        get: () => undefined,
        upsert: () => {
          persisted += 1;
        },
      },
      offlineRunwayService: { enqueueEvaluation: () => {} },
      diagnosticsService: { record: () => {} },
      stateManager: {
        getState: () => ({ provider: "vidking", mode: "series" }),
        dispatch: () => {},
      },
    } as unknown as Container;

    const result = await commitDownloadIntent(container, {
      title: { id: "tmdb:7", type: "series", name: "Show" },
      mediaKind: "series",
      items: [
        { kind: "episode", episode: { season: 1, episode: 1 } },
        { kind: "episode", episode: { season: 1, episode: 2 } },
      ],
      profile: SERIES_PROFILE,
    });

    expect(result).toEqual({ status: "queued", queuedCount: 1 });
    expect(persisted).toBe(1);
  });
});

/**
 * A movie has no episode. Persisting a synthetic season 1 / episode 1 made the
 * job claim an episode that does not exist, which then surfaced as "S01E01"
 * everywhere the row was read.
 */
describe("commitDownloadIntent authoritative kind", () => {
  function harness(mode: string) {
    const enqueued: Record<string, unknown>[] = [];
    const container = {
      config: { offlineDefaultRunwayTarget: 2 },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async (input: Record<string, unknown>) => {
          enqueued.push(input);
          return { id: `job-${enqueued.length}` };
        },
        processQueue: () => {},
      },
      offlineTitlePolicies: { get: () => undefined, upsert: () => {} },
      offlineRunwayService: { enqueueEvaluation: () => {} },
      diagnosticsService: { record: () => {} },
      stateManager: {
        getState: () => ({ provider: "vidking", mode }),
        dispatch: () => {},
      },
    } as unknown as Container;
    return { container, enqueued };
  }

  test("committing a movie omits episode persistence", async () => {
    const { container, enqueued } = harness("series");
    const movie = { id: "tmdb:1", type: "movie" as const, name: "Dune: Part Two" };

    await commitDownloadIntent(container, {
      title: movie,
      mediaKind: "movie",
      items: [{ kind: "title" }],
      profile: SERIES_PROFILE,
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ title: movie, episode: undefined, mode: "series" });
  });

  test("committing a video enqueues title-level through youtube mode", async () => {
    const { container, enqueued } = harness("series");
    const video = { id: "yt:1", type: "series" as const, name: "Trailer" };

    await commitDownloadIntent(container, {
      title: video,
      mediaKind: "video",
      items: [{ kind: "title" }],
      profile: SERIES_PROFILE,
    });

    expect(enqueued[0]).toMatchObject({ episode: undefined, mode: "youtube" });
  });

  test("committing anime uses anime mode and carries the episode", async () => {
    const { container, enqueued } = harness("series");

    await commitDownloadIntent(container, {
      title: { id: "anilist:1", type: "series", name: "Frieren" },
      mediaKind: "anime",
      items: [{ kind: "episode", episode: { season: 1, episode: 3 } }],
      profile: SERIES_PROFILE,
    });

    expect(enqueued[0]).toMatchObject({
      mode: "anime",
      episode: { season: 1, episode: 3 },
    });
  });

  test("an empty item list queues nothing", async () => {
    const { container, enqueued } = harness("series");

    await expect(
      commitDownloadIntent(container, {
        title: { id: "tmdb:1", type: "movie", name: "Movie" },
        mediaKind: "movie",
        items: [],
        profile: SERIES_PROFILE,
      }),
    ).resolves.toEqual({ status: "none", queuedCount: 0 });
    expect(enqueued).toHaveLength(0);
  });
});
