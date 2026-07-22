import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";

import type { TitleInfo } from "@/domain/types";

const invidiousGetVideo = mock(async () => null as never);
const invidiousGetChannelVideos = mock(async () => null as never);
const invidiousGetTrending = mock(async () => [] as never);
const mapInvidiousRecommendedVideos = mock((items: unknown) => items as never);
const mapInvidiousSearchItem = mock(
  (_item?: { videoId?: string; title?: string }) => null as null | Record<string, unknown>,
);
const mapInvidiousTrendingVideos = mock((items: unknown[]) => items as never);
const getYoutubeProviderConfig = mock(() => ({ invidiousInstanceUrl: undefined }));

// `mock.module` is process-global in Bun and applies at file-LOAD time, so it
// affects every other test file in the run — including files that execute before
// this one. Two rules keep it contained:
//   1. Spread the real module so exports this test does not stub keep working.
//   2. Never stub a pure helper (id parsing/formatting) — use the real one. The
//      previous stub invented a fake `yt:video:` id grammar, which silently
//      broke `isYoutubeCollectionCatalogId` for unrelated suites.
// Only the network/mapping seams below are stubbed, and `afterAll` restores the
// module so even those cannot outlive this file.
const actualYoutubeModule = await import("@kunai/providers/youtube");

mock.module("@kunai/providers/youtube", () => ({
  ...actualYoutubeModule,
  getYoutubeProviderConfig,
  invidiousGetVideo,
  invidiousGetChannelVideos,
  invidiousGetTrending,
  mapInvidiousRecommendedVideos,
  mapInvidiousSearchItem,
  mapInvidiousTrendingVideos,
}));

afterAll(() => {
  mock.module("@kunai/providers/youtube", () => actualYoutubeModule);
});

const { loadYoutubeRecommendations } =
  await import("@/services/youtube/YoutubeRecommendationService");

afterEach(() => {
  invidiousGetVideo.mockClear();
  invidiousGetChannelVideos.mockClear();
  invidiousGetTrending.mockClear();
});

function relatedBatch(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `youtube:rel${i}`,
    type: "movie" as const,
    title: `Related ${i}`,
  }));
}

describe("loadYoutubeRecommendations", () => {
  it("skips channel fan-out when related already fills the rail", async () => {
    mapInvidiousRecommendedVideos.mockImplementation(() => relatedBatch(8) as never);
    invidiousGetVideo.mockResolvedValue({
      authorId: "UCmine",
      recommendedVideos: [{}],
    } as never);

    const title = {
      id: "youtube:abc",
      name: "Clip",
      type: "movie",
      externalIds: { youtubeId: "abc", youtubeChannelId: "UCmine" },
    } as TitleInfo;

    const items = await loadYoutubeRecommendations({
      title,
      historySeeds: [
        {
          titleId: "youtube:other",
          externalIds: { youtubeChannelId: "UChistory" },
          mediaKind: "video",
          providerId: "youtube",
        },
      ],
    });

    expect(items).toHaveLength(8);
    expect(invidiousGetChannelVideos).not.toHaveBeenCalled();
  });

  it("does not treat an unrelated history channel as the current channel", async () => {
    mapInvidiousRecommendedVideos.mockImplementation(() => relatedBatch(1) as never);
    invidiousGetVideo.mockResolvedValue({
      recommendedVideos: [{}],
      // no authorId
    } as never);
    invidiousGetChannelVideos.mockResolvedValue({
      author: "Hist",
      authorId: "UChistory",
      latestVideos: [{ videoId: "h1", title: "H", lengthSeconds: 10 }],
    } as never);
    mapInvidiousSearchItem.mockImplementation(((item: { videoId?: string }) =>
      item.videoId
        ? {
            id: `youtube:${item.videoId}`,
            type: "movie",
            title: item.videoId,
          }
        : null) as typeof mapInvidiousSearchItem);

    const title = {
      id: "youtube:abc",
      name: "Clip",
      type: "movie",
      externalIds: { youtubeId: "abc" },
    } as TitleInfo;

    await loadYoutubeRecommendations({
      title,
      historySeeds: [
        {
          titleId: "youtube:other",
          externalIds: { youtubeChannelId: "UChistory" },
          mediaKind: "video",
          providerId: "youtube",
        },
      ],
    });

    // Affinity may still fetch UChistory, but not as "same channel" exclusion of itself.
    expect(invidiousGetChannelVideos).toHaveBeenCalledWith(
      "UChistory",
      expect.objectContaining({}),
    );
  });
});
