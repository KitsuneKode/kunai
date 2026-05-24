import { describe, expect, test } from "bun:test";

import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
import { OfflineRunwayService } from "@/services/offline/OfflineRunwayService";

const policy = {
  titleId: "anilist:1",
  mediaKind: "anime" as const,
  titleName: "Demo",
  enrolled: true,
  runwayTarget: 2,
  profileJson: JSON.stringify({ audio: "sub", subtitle: "en", quality: "best" }),
  cleanupJson: "{}",
  updatedAt: "2026-05-24T00:00:00.000Z",
};

function createService(overrides: Record<string, unknown> = {}) {
  const enqueued: unknown[] = [];
  const policyWrites: unknown[] = [];
  const service = new OfflineRunwayService({
    policies: {
      get: () => policy,
      upsert: (next: typeof policy) => {
        policyWrites.push(next);
        return next;
      },
    },
    assets: {
      listTitleAssets: () => [
        {
          season: 1,
          episode: 5,
          state: "ready",
          originJobId: "source-job",
        },
      ],
    },
    historyStore: {
      listByTitle: async () => [{ season: 1, episode: 4 }],
    },
    releaseProgressCache: {
      getByTitleIds: () =>
        new Map([
          [
            "anilist:1",
            {
              latestAiredSeason: 1,
              latestAiredEpisode: 7,
            },
          ],
        ]),
    },
    downloadService: {
      getJob: () => ({
        id: "source-job",
        providerId: "allanime",
        mediaKind: "anime",
        mode: "anime",
      }),
      hasJobForEpisode: () => false,
      listActive: () => [],
      estimateAvailableEpisodeSlots: async () => 1,
      enqueue: async (input: unknown) => {
        enqueued.push(input);
        return {} as never;
      },
      processQueue: async () => {},
    },
    scheduler: { enqueue: () => {}, drain: async () => ({}) as never },
    ...overrides,
  } as never);
  return { service, enqueued, policyWrites };
}

describe("OfflineRunwayService", () => {
  test("uses cached release truth to enqueue one approved deficit without provider discovery", async () => {
    const { service, enqueued } = createService();

    const result = await service.evaluateTitle("anilist:1", "offline-playback-complete");

    expect(result.enqueued).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      title: { id: "anilist:1", name: "Demo" },
      episode: { season: 1, episode: 6 },
      providerId: "allanime",
      mode: "anime",
    });
  });

  test("does nothing for a title not explicitly enrolled", async () => {
    const { service, enqueued } = createService({
      policies: { get: () => ({ ...policy, enrolled: false }), upsert: () => policy },
    });

    const result = await service.evaluateTitle("anilist:1", "offline-playback-complete");

    expect(result.skipReason).toBe("not-enrolled");
    expect(enqueued).toEqual([]);
  });

  test("pauses the title after indexed admission rejects low disk space", async () => {
    const { service, policyWrites } = createService({
      downloadService: {
        getJob: () => ({
          id: "source-job",
          providerId: "allanime",
          mediaKind: "anime",
          mode: "anime",
        }),
        hasJobForEpisode: () => false,
        listActive: () => [],
        estimateAvailableEpisodeSlots: async () => 1,
        enqueue: async () => {
          throw new DownloadEnqueueRejectedError("insufficient-disk", "full");
        },
        processQueue: async () => {},
      },
    });

    const result = await service.evaluateTitle("anilist:1", "maintenance");

    expect(result.skipReason).toBe("low-space");
    expect(policyWrites[0]).toMatchObject({ pausedReason: "low-space" });
  });

  test("counts queued and running jobs toward the local runway before enqueueing more", async () => {
    const { service, enqueued } = createService({
      assets: {
        listTitleAssets: () => [
          {
            season: 1,
            episode: 5,
            state: "ready",
            originJobId: "source-job",
          },
        ],
      },
      downloadService: {
        getJob: () => ({
          id: "source-job",
          providerId: "allanime",
          mediaKind: "anime",
          mode: "anime",
        }),
        hasJobForEpisode: () => false,
        listActive: () => [
          {
            titleId: "anilist:1",
            season: 1,
            episode: 6,
            status: "queued",
          },
        ],
        estimateAvailableEpisodeSlots: async () => 2,
        enqueue: async (input: unknown) => {
          enqueued.push(input);
          return {} as never;
        },
        processQueue: async () => {},
      },
    });

    const result = await service.evaluateTitle("anilist:1", "offline-playback-complete");

    expect(result.skipReason).toBe("already-healthy");
    expect(enqueued).toEqual([]);
  });
});
