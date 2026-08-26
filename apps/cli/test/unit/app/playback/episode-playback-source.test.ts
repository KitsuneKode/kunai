import { describe, expect, test } from "bun:test";

import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { OfflineTitleIdentityService } from "@/services/offline/offline-title-identity";

const TITLE: TitleInfo = {
  id: "allanime-native-id",
  type: "series",
  name: "Demo",
  externalIds: { anilistId: "151807" },
  isAnime: true,
};
const EPISODE: EpisodeInfo = {
  season: 1,
  episode: 1,
  providerEpisodeIdentity: { providerId: "allanime", value: "1" },
};
const SOURCE: LocalPlaybackSource = {
  kind: "local",
  jobId: "job-1",
  titleId: "151807",
  titleName: "Demo",
  mediaKind: "series",
  providerId: "allanime",
  season: 1,
  episode: 1,
  providerEpisodeIdentity: { providerId: "allanime", value: "1" },
  filePath: "/tmp/demo.mkv",
};

describe("resolveLocalEpisodePlayback", () => {
  test("matches canonical assets without serving a different native episode at the same UI index", async () => {
    // The asset is filed under the canonical id (the AniList id), not the
    // opaque provider-native id the title carries. The title proves that id for
    // itself, so the resolver answers it without consulting the alias index and
    // the canonical form is the *only* id asked for — writes resolve the same
    // way, so there is no second id worth trying.
    const requestedTitleIds: string[] = [];
    let storedNativeValue = "1";
    let playableReads = 0;
    const assetsById = (titleId: string) =>
      titleId === "151807"
        ? [
            {
              titleId,
              state: "ready",
              season: 1,
              episode: 1,
              providerEpisodeIdentity: { providerId: "allanime", value: storedNativeValue },
              originJobId: "job-1",
            },
          ]
        : [];
    const container = {
      config: { continueSourcePreference: "stream" },
      connectivity: { isOnline: () => true },
      stateManager: { getState: () => ({ mode: "anime" }) },
      offlineTitleIdentity: new OfflineTitleIdentityService(
        { lookupTitleIdByAliasId: () => undefined },
        { relocateTitleId: () => 0 },
      ),
      offlineAssetService: {
        listTitleAssets: (titleId: string) => {
          requestedTitleIds.push(titleId);
          return assetsById(titleId);
        },
      },
      offlineLibraryService: {
        getPlayableSource: async () => {
          playableReads += 1;
          return {
            status: "ready" as const,
            source: SOURCE,
            job: { id: "job-1" },
          };
        },
      },
    } as unknown as Container;

    const result = await resolveLocalEpisodePlayback(container, TITLE, EPISODE, {
      forceLocal: true,
    });

    expect(requestedTitleIds).toEqual(["151807"]);
    expect(result?.jobId).toBe("job-1");
    expect(playableReads).toBe(1);

    storedNativeValue = "0";
    const staleResult = await resolveLocalEpisodePlayback(container, TITLE, EPISODE, {
      forceLocal: true,
    });

    expect(staleResult).toBeNull();
    expect(playableReads).toBe(1);
  });
});
