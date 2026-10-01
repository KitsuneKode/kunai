import { describe, expect, test } from "bun:test";

import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import { resolvePlaybackSourceAuthority } from "@/app/playback/playback-source-authority";
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
    let providerReads = 0;
    let episodeTwoReady = false;
    let jobBGone = false;
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
      connectivity: {
        isOnline: () => {
          providerReads += 1;
          throw new Error("network down");
        },
      },
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
        findReadyOriginJobId: (
          titleId: string,
          _season: number,
          episode: number,
          _mediaKind: string | undefined,
          identity: { readonly providerId: string; readonly value: string } | undefined,
        ) => {
          if (episode === 2) return episodeTwoReady ? "job-2" : undefined;
          requestedTitleIds.push(titleId);
          return assetsById(titleId).find((asset) => {
            if (asset.state !== "ready") return false;
            if (!identity) return true;
            return (
              asset.providerEpisodeIdentity?.providerId === identity.providerId &&
              asset.providerEpisodeIdentity?.value === identity.value
            );
          })?.originJobId;
        },
      },
      offlineLibraryService: {
        getPlayableSource: async (jobId: string) => {
          playableReads += 1;
          if (jobId === "job-missing") return { status: "not-found" as const };
          if (jobId === "job-b") {
            if (jobBGone) {
              return {
                status: "missing" as const,
                job: {
                  id: "job-b",
                  season: 1,
                  episode: 1,
                  providerEpisodeIdentity: { providerId: "allanime", value: "b" },
                },
              };
            }
            return {
              status: "ready" as const,
              source: {
                ...SOURCE,
                jobId: "job-b",
                filePath: "/tmp/b.mkv",
                providerEpisodeIdentity: { providerId: "allanime", value: "b" },
              },
              job: {
                id: "job-b",
                season: 1,
                episode: 1,
                providerEpisodeIdentity: { providerId: "allanime", value: "b" },
              },
            };
          }
          const source = jobId === "job-2" ? { ...SOURCE, jobId: "job-2", episode: 2 } : SOURCE;
          return {
            status: "ready" as const,
            source,
            job: { id: source.jobId, season: 1, episode: source.episode ?? 1 },
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

    episodeTwoReady = true;
    const selected = await resolveLocalEpisodePlayback(
      container,
      { ...TITLE, offlineJobId: "job-1" },
      { season: 1, episode: 2 },
      { forceLocal: true },
    );
    expect(selected?.jobId).toBe("job-2");
    expect(selected?.source.episode).toBe(2);

    episodeTwoReady = false;
    const missing = await resolveLocalEpisodePlayback(
      container,
      { ...TITLE, offlineJobId: "job-1" },
      { season: 1, episode: 2 },
      { forceLocal: true },
    );
    expect(missing).toBeNull();

    const episodeB: EpisodeInfo = {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "b" },
    };
    const selectedFile = await resolveLocalEpisodePlayback(
      container,
      { ...TITLE, offlineJobId: "job-b" },
      episodeB,
      { forceLocal: true },
    );
    expect(selectedFile?.source.filePath).toBe("/tmp/b.mkv");
    expect(selectedFile?.jobId).toBe("job-b");

    jobBGone = true;
    const gone = await resolveLocalEpisodePlayback(
      container,
      { ...TITLE, offlineJobId: "job-b" },
      episodeB,
      { forceLocal: true },
    );
    expect(gone).toBeNull();

    storedNativeValue = "1";
    const deletedSelection = await resolveLocalEpisodePlayback(
      container,
      { ...TITLE, offlineJobId: "job-missing" },
      EPISODE,
      { forceLocal: true },
    );
    expect(deletedSelection).toBeNull();

    jobBGone = false;
    const authority = await resolvePlaybackSourceAuthority(
      container,
      { ...TITLE, offlineJobId: "job-b" },
      episodeB,
      { forceLocal: true },
    );
    expect(authority.kind).toBe("local");
    if (authority.kind === "local") {
      expect(authority.resolution.source.filePath).toBe("/tmp/b.mkv");
    }
    expect(providerReads).toBe(0);
  });
});
