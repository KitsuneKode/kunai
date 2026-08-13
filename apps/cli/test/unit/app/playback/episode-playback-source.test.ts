import { describe, expect, test } from "bun:test";

import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

const TITLE: TitleInfo = {
  id: "allanime-native-id",
  type: "series",
  name: "Demo",
  externalIds: { anilistId: "151807" },
  isAnime: true,
};
const EPISODE: EpisodeInfo = { season: 1, episode: 1 };
const SOURCE: LocalPlaybackSource = {
  kind: "local",
  jobId: "job-1",
  titleId: "151807",
  titleName: "Demo",
  mediaKind: "series",
  providerId: "allanime",
  season: 1,
  episode: 1,
  filePath: "/tmp/demo.mkv",
};

describe("resolveLocalEpisodePlayback", () => {
  test("matches downloaded assets by the canonical title id", async () => {
    // The asset is filed under the canonical id (the AniList id), not the
    // opaque provider-native id the title carries, so the canonical form has to
    // be among the ids asked for. The raw id rides along as a fallback because
    // `offline_assets.title_id` is written verbatim from `job.titleId`, which
    // is only canonical when the job happened to know the external ids.
    const requestedTitleIds: string[] = [];
    const assetsById = (titleId: string) =>
      titleId === "151807"
        ? [{ titleId, state: "ready", season: 1, episode: 1, originJobId: "job-1" }]
        : [];
    const container = {
      config: { continueSourcePreference: "stream" },
      connectivity: { isOnline: () => true },
      stateManager: { getState: () => ({ mode: "anime" }) },
      offlineAssetService: {
        listTitleAssets: (titleId: string) => {
          requestedTitleIds.push(titleId);
          return assetsById(titleId);
        },
        listByTitleIds: (titleIds: readonly string[]) => {
          requestedTitleIds.push(...titleIds);
          return titleIds.flatMap(assetsById);
        },
      },
      offlineLibraryService: {
        getPlayableSource: async () => ({
          status: "ready" as const,
          source: SOURCE,
          job: { id: "job-1" },
        }),
      },
    } as unknown as Container;

    const result = await resolveLocalEpisodePlayback(container, TITLE, EPISODE, {
      forceLocal: true,
    });

    expect(requestedTitleIds).toContain("151807");
    expect(result?.jobId).toBe("job-1");
  });
});
