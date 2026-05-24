import { expect, test } from "bun:test";

import { DownloadOnlyPhase } from "@/app/DownloadOnlyPhase";
import type { PhaseContext } from "@/app/Phase";

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
      diagnosticsStore: { record: () => {} },
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
      diagnosticsStore: { record: () => {} },
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
        upsert: (input: { titleId: string }) => {
          policyTitleId = input.titleId;
        },
      },
      offlineRunwayService: {
        enqueueEvaluation: (titleId: string) => {
          scheduledTitleId = titleId;
        },
      },
      diagnosticsStore: { record: () => {} },
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
