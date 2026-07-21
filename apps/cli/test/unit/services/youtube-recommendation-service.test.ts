import { afterEach, describe, expect, it, mock } from "bun:test";

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
const parseYoutubeCatalogId = mock((id: string) => {
  if (id.startsWith("yt:video:")) {
    return { kind: "video" as const, nativeId: id.slice("yt:video:".length) };
  }
  return { kind: "unknown" as const, nativeId: id };
});
const toYoutubeVideoCatalogId = mock((id: string) => `yt:video:${id}`);

mock.module("@kunai/providers/youtube", () => ({
  getYoutubeProviderConfig,
  invidiousGetVideo,
  invidiousGetChannelVideos,
  invidiousGetTrending,
  mapInvidiousRecommendedVideos,
  mapInvidiousSearchItem,
  mapInvidiousTrendingVideos,
  parseYoutubeCatalogId,
  toYoutubeVideoCatalogId,
}));

const { loadYoutubeRecommendations } =
  await import("@/services/youtube/YoutubeRecommendationService");

afterEach(() => {
  invidiousGetVideo.mockClear();
  invidiousGetChannelVideos.mockClear();
  invidiousGetTrending.mockClear();
});

function relatedBatch(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `yt:video:rel${i}`,
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
      id: "yt:video:abc",
      name: "Clip",
      type: "movie",
      externalIds: { youtubeId: "abc", youtubeChannelId: "UCmine" },
    } as TitleInfo;

    const items = await loadYoutubeRecommendations({
      title,
      historySeeds: [
        {
          titleId: "yt:video:other",
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
            id: `yt:video:${item.videoId}`,
            type: "movie",
            title: item.videoId,
          }
        : null) as typeof mapInvidiousSearchItem);

    const title = {
      id: "yt:video:abc",
      name: "Clip",
      type: "movie",
      externalIds: { youtubeId: "abc" },
    } as TitleInfo;

    await loadYoutubeRecommendations({
      title,
      historySeeds: [
        {
          titleId: "yt:video:other",
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
