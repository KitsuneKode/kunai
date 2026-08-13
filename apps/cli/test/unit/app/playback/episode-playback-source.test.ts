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
    const requestedTitleIds: string[] = [];
    const container = {
      config: { continueSourcePreference: "stream" },
      connectivity: { isOnline: () => true },
      stateManager: { getState: () => ({ mode: "anime" }) },
      offlineAssetService: {
        listTitleAssets: (titleId: string) => {
          requestedTitleIds.push(titleId);
          return titleId === "151807"
            ? [{ titleId, state: "ready", season: 1, episode: 1, originJobId: "job-1" }]
            : [];
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

    expect(requestedTitleIds).toEqual(["151807"]);
    expect(result?.jobId).toBe("job-1");
  });
});
