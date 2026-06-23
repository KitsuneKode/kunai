import { describe, expect, test } from "bun:test";

import type { Container } from "@/container";
import {
  buildDefaultDownloadProfile,
  commitDownloadIntent,
  resolveDownloadIntentEpisodes,
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

describe("resolveDownloadIntentEpisodes", () => {
  test("movies resolve to a single slot", () => {
    expect(
      resolveDownloadIntentEpisodes({
        title: { id: "tmdb:1", type: "movie", name: "Movie" },
        season: 4,
        episode: 9,
      }),
    ).toEqual([{ season: 1, episode: 1 }]);
  });

  test("series use the carried season/episode when present", () => {
    expect(
      resolveDownloadIntentEpisodes({
        title: { id: "tmdb:1", type: "series", name: "Show" },
        season: 2,
        episode: 5,
      }),
    ).toEqual([{ season: 2, episode: 5 }]);
  });

  test("series without episode info fall back to the first episode", () => {
    expect(
      resolveDownloadIntentEpisodes({
        title: { id: "tmdb:1", type: "series", name: "Show" },
      }),
    ).toEqual([{ season: 1, episode: 1 }]);
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
      episodes: [{ season: 1, episode: 1 }],
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
      episodes: [
        { season: 1, episode: 1 },
        { season: 1, episode: 2 },
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
      episodes: [
        { season: 1, episode: 1 },
        { season: 1, episode: 2 },
      ],
      profile: SERIES_PROFILE,
    });

    expect(result).toEqual({ status: "queued", queuedCount: 1 });
    expect(persisted).toBe(1);
  });
});
