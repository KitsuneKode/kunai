import { expect, test } from "bun:test";

import {
  DownloadOnlyPhase,
  updateDownloadConfirmationProfile,
} from "@/app/playback/DownloadOnlyPhase";
import type { PhaseContext } from "@/app/session/Phase";

test("DownloadOnlyPhase does not discover provider episodes when downloads are disabled", async () => {
  let providerReads = 0;
  let episodeCalls = 0;
  const context = {
    signal: new AbortController().signal,
    container: {
      stateManager: {
        getState: () => ({ provider: "allanime", mode: "anime" }),
        dispatch: () => {},
      },
      providerRegistry: {
        get: () => {
          providerReads += 1;
          return {
            listEpisodes: async () => {
              episodeCalls += 1;
              return [];
            },
          };
        },
      },
      downloadService: {
        getEnqueueEligibility: () => ({
          allowed: false,
          code: "downloads-disabled",
          reason: "Downloads are disabled.",
        }),
      },
      diagnosticsService: { record: () => {} },
    },
  } as unknown as PhaseContext;

  const result = await new DownloadOnlyPhase().execute(
    { title: { id: "anilist:1", type: "series", name: "Demo" } },
    context,
  );

  expect(result).toEqual({ status: "success", value: "back" });
  expect(providerReads).toBe(0);
  expect(episodeCalls).toBe(0);
});

test("DownloadOnlyPhase does not contact anime providers before download profile confirmation", async () => {
  let providerReads = 0;
  let enqueues = 0;
  let confirmedProfile = false;
  let confirmedTitlePrepares = 0;
  const context = {
    signal: new AbortController().signal,
    container: {
      config: {
        offlineArtworkCacheEnabled: true,
        downloadPath: "",
        offlineDefaultRunwayTarget: 2,
      },
      stateManager: {
        getState: () => ({
          provider: "allanime",
          mode: "anime",
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
          seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
      providerRegistry: {
        get: () => {
          providerReads += 1;
          return {
            listEpisodes: async () => {
              throw new Error("provider must stay untouched before confirmation");
            },
          };
        },
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => {
          enqueues += 1;
          return { id: "job-1" };
        },
        processQueue: () => {},
      },
      offlineTitlePolicies: { upsert: () => {} },
      diagnosticsService: { record: () => {} },
    },
  } as unknown as PhaseContext;

  const phase = new DownloadOnlyPhase({
    pickEpisodes: async () => [{ season: 1, episode: 3 }],
    confirmProfile: async () => {
      confirmedProfile = true;
      return null;
    },
    prepareConfirmedTitle: async (title) => {
      confirmedTitlePrepares += 1;
      return title;
    },
  });
  const result = await phase.execute(
    { title: { id: "anilist:1", type: "series", name: "Demo" } },
    context,
  );

  expect(result).toEqual({ status: "success", value: "back" });
  expect(confirmedProfile).toBe(true);
  expect(providerReads).toBe(0);
  expect(confirmedTitlePrepares).toBe(0);
  expect(enqueues).toBe(0);
});

test("DownloadOnlyPhase schedules a bounded runway evaluation when enrolling keep watching offline", async () => {
  let scheduledTitleId: string | undefined;
  let policyTitleId: string | undefined;
  const context = {
    signal: new AbortController().signal,
    container: {
      config: {
        offlineArtworkCacheEnabled: false,
        downloadPath: "",
        offlineDefaultRunwayTarget: 2,
      },
      stateManager: {
        getState: () => ({
          provider: "allanime",
          mode: "anime",
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
          seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => ({ id: "job-1" }),
        processQueue: () => {},
      },
      offlineTitlePolicies: {
        get: () => undefined,
        upsert: (input: { titleId: string }) => {
          policyTitleId = input.titleId;
        },
      },
      offlineRunwayService: {
        enqueueEvaluation: (titleId: string) => {
          scheduledTitleId = titleId;
        },
      },
      diagnosticsService: { record: () => {} },
    },
  } as unknown as PhaseContext;

  const result = await new DownloadOnlyPhase({
    pickEpisodes: async () => [{ season: 1, episode: 3 }],
    confirmProfile: async ({ profile }) => ({
      ...profile,
      enrollKeepWatchingOffline: true,
    }),
  }).execute({ title: { id: "anilist:1", type: "series", name: "Demo" } }, context);

  expect(result).toEqual({ status: "success", value: "queued" });
  expect(policyTitleId).toBe("anilist:1");
  expect(scheduledTitleId).toBe("anilist:1");
});

test("download confirmation edits remain local until the final queued profile is applied", () => {
  const initial = {
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "best",
    cacheArtwork: false,
    enrollKeepWatchingOffline: false,
    runwayTarget: 2,
    cleanupPolicy: { mode: "keep-last-watched" as const, count: 1 },
  };

  const subtitles = updateDownloadConfirmationProfile(initial, "cycle-subtitle");
  const artwork = updateDownloadConfirmationProfile(subtitles, "toggle-artwork");
  const cleanup = updateDownloadConfirmationProfile(artwork, "toggle-cleanup");

  expect(cleanup).toMatchObject({
    subtitlePreference: "none",
    cacheArtwork: true,
    cleanupPolicy: { mode: "cleanup-watched", graceDays: 7 },
  });
});

test("DownloadOnlyPhase persists the confirmed title cleanup preference with the offline runway policy", async () => {
  let persistedPolicy:
    | {
        profileJson: string;
        cleanupJson: string;
      }
    | undefined;
  const context = {
    signal: new AbortController().signal,
    container: {
      config: {
        offlineArtworkCacheEnabled: false,
        downloadPath: "/downloads",
        offlineDefaultRunwayTarget: 2,
      },
      stateManager: {
        getState: () => ({
          provider: "vidking",
          mode: "series",
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
          seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => ({ id: "job-1" }),
        processQueue: () => {},
      },
      offlineTitlePolicies: {
        get: () => undefined,
        upsert: (input: { profileJson: string; cleanupJson: string }) => {
          persistedPolicy = input;
        },
      },
      offlineRunwayService: { enqueueEvaluation: () => {} },
      diagnosticsService: { record: () => {} },
    },
  } as unknown as PhaseContext;

  await new DownloadOnlyPhase({
    pickEpisodes: async () => [{ season: 1, episode: 3 }],
    confirmProfile: async ({ profile }) => ({
      ...profile,
      enrollKeepWatchingOffline: true,
      subtitlePreference: "none",
      cacheArtwork: true,
      cleanupPolicy: { mode: "cleanup-watched", graceDays: 14 },
    }),
  }).execute({ title: { id: "tmdb:1", type: "series", name: "Demo" } }, context);

  expect(JSON.parse(persistedPolicy?.profileJson ?? "{}")).toMatchObject({
    subtitle: "none",
    cacheArtwork: true,
  });
  expect(JSON.parse(persistedPolicy?.cleanupJson ?? "{}")).toEqual({
    mode: "cleanup-watched",
    graceDays: 14,
  });
});

test("DownloadOnlyPhase stores a one-off series cleanup choice without enrolling background runway work", async () => {
  let enrolled: boolean | undefined;
  let cleanupJson: string | undefined;
  let scheduled = 0;
  const context = {
    signal: new AbortController().signal,
    container: {
      config: {
        offlineArtworkCacheEnabled: false,
        downloadPath: "",
        offlineDefaultRunwayTarget: 2,
      },
      stateManager: {
        getState: () => ({
          provider: "vidking",
          mode: "series",
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
          seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => ({ id: "job-1" }),
        processQueue: () => {},
      },
      offlineTitlePolicies: {
        get: () => undefined,
        upsert: (input: { enrolled: boolean; cleanupJson: string }) => {
          enrolled = input.enrolled;
          cleanupJson = input.cleanupJson;
        },
      },
      offlineRunwayService: {
        enqueueEvaluation: () => {
          scheduled += 1;
        },
      },
      diagnosticsService: { record: () => {} },
    },
  } as unknown as PhaseContext;

  await new DownloadOnlyPhase({
    pickEpisodes: async () => [{ season: 1, episode: 3 }],
    confirmProfile: async ({ profile }) => ({
      ...profile,
      cleanupPolicy: { mode: "cleanup-watched", graceDays: 7 },
    }),
  }).execute({ title: { id: "tmdb:1", type: "series", name: "Demo" } }, context);

  expect(enrolled).toBe(false);
  expect(JSON.parse(cleanupJson ?? "{}")).toEqual({
    mode: "cleanup-watched",
    graceDays: 7,
  });
  expect(scheduled).toBe(0);
});

test("DownloadOnlyPhase keeps an existing offline runway enrollment during a one-off queue", async () => {
  let enrolled: boolean | undefined;
  const context = {
    signal: new AbortController().signal,
    container: {
      config: {
        offlineArtworkCacheEnabled: false,
        downloadPath: "",
        offlineDefaultRunwayTarget: 2,
      },
      stateManager: {
        getState: () => ({
          provider: "vidking",
          mode: "series",
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
          seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => ({ id: "job-1" }),
        processQueue: () => {},
      },
      offlineTitlePolicies: {
        get: () => ({
          titleId: "tmdb:1",
          titleName: "Demo",
          mediaKind: "series",
          enrolled: true,
          runwayTarget: 3,
          profileJson: "{}",
          cleanupJson: "{}",
          updatedAt: "2026-05-01T00:00:00.000Z",
        }),
        upsert: (input: { enrolled: boolean }) => {
          enrolled = input.enrolled;
        },
      },
      offlineRunwayService: { enqueueEvaluation: () => {} },
      diagnosticsService: { record: () => {} },
    },
  } as unknown as PhaseContext;

  await new DownloadOnlyPhase({
    pickEpisodes: async () => [{ season: 1, episode: 4 }],
    confirmProfile: async ({ profile }) => profile,
  }).execute({ title: { id: "tmdb:1", type: "series", name: "Demo" } }, context);

  expect(enrolled).toBe(true);
});

test("DownloadOnlyPhase persists profile intent after a partially queued series batch", async () => {
  let enqueueCount = 0;
  let persisted = 0;
  const context = {
    signal: new AbortController().signal,
    container: {
      config: {
        offlineArtworkCacheEnabled: false,
        downloadPath: "",
        offlineDefaultRunwayTarget: 2,
      },
      stateManager: {
        getState: () => ({
          provider: "vidking",
          mode: "series",
          animeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
          seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () => {
          enqueueCount += 1;
          if (enqueueCount === 2) throw new Error("second item rejected");
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
    },
  } as unknown as PhaseContext;

  const result = await new DownloadOnlyPhase({
    pickEpisodes: async () => [
      { season: 1, episode: 3 },
      { season: 1, episode: 4 },
    ],
    confirmProfile: async ({ profile }) => profile,
  }).execute({ title: { id: "tmdb:1", type: "series", name: "Demo" } }, context);

  expect(result).toEqual({ status: "success", value: "queued" });
  expect(persisted).toBe(1);
});
