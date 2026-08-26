import { describe, expect, test } from "bun:test";

import {
  downloadedCountForTitle,
  findNextReadyEpisode,
  findReadyJobIdForEpisode,
  isEpisodeDownloaded,
} from "@/services/offline/offline-episode-index";
import {
  OfflineAssetService,
  type OfflineAssetRepositoryPort,
} from "@/services/offline/OfflineAssetService";
import type { OfflineAssetRecord, OfflineNextReadyCursor } from "@kunai/storage";

/** Identity is not what these tests exercise: keep whatever id the job carried. */
const passthroughIdentity = {
  resolveForTitle: (title: { id: string }) => title.id,
  resolveForJob: (job: { titleId: string }) => job.titleId,
};

function asset(
  partial: Partial<OfflineAssetRecord> & Pick<OfflineAssetRecord, "titleId">,
): OfflineAssetRecord {
  return {
    id: partial.id ?? `asset-${partial.titleId}`,
    titleId: partial.titleId,
    titleName: partial.titleName ?? "Demo",
    mediaKind: partial.mediaKind ?? "series",
    season: partial.season,
    episode: partial.episode,
    providerEpisodeIdentity: partial.providerEpisodeIdentity,
    profileKey: partial.profileKey ?? "series:original:none:best",
    originJobId: partial.originJobId ?? "job-1",
    filePath: partial.filePath ?? "/tmp/demo.mkv",
    state: partial.state ?? "ready",
    byteSize: partial.byteSize ?? 1,
    durationMs: partial.durationMs,
    timingJson: partial.timingJson,
    lastValidatedAt: partial.lastValidatedAt,
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
    identityKey: partial.identityKey ?? `${partial.titleId}:1:1`,
    protected: partial.protected ?? false,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

function repositoryStub(
  overrides: Partial<OfflineAssetRepositoryPort> = {},
): OfflineAssetRepositoryPort {
  return {
    get: () => undefined,
    listTitleAssets: () => [],
    listByTitleIds: () => [],
    listNextReadyByTitleCursors: () => [],
    markValidation: () => {},
    deleteByOriginJobId: () => {},
    deleteOrphaned: () => 0,
    upsertPlayable: () => asset({ titleId: "test-title" }),
    ...overrides,
  };
}

describe("offline-episode-index", () => {
  test("isEpisodeDownloaded and downloadedCountForTitle read ready assets", () => {
    const repo = repositoryStub({
      listTitleAssets: () => [
        asset({ titleId: "t1", season: 1, episode: 1 }),
        asset({ titleId: "t1", season: 1, episode: 2, state: "missing" }),
        asset({ titleId: "t1", season: 1, episode: 3 }),
      ],
      upsertPlayable: () => asset({ titleId: "t1" }),
    });
    const service = new OfflineAssetService(repo, passthroughIdentity);

    expect(isEpisodeDownloaded(service, "t1", 1, 1)).toBe(true);
    expect(isEpisodeDownloaded(service, "t1", 1, 2)).toBe(false);
    expect(downloadedCountForTitle(service, "t1")).toBe(2);
  });

  test("finds downloaded movies without inventing an episode axis", () => {
    const repo = repositoryStub({
      listTitleAssets: () => [asset({ titleId: "movie-1", mediaKind: "movie" })],
      upsertPlayable: () => asset({ titleId: "movie-1", mediaKind: "movie" }),
    });
    const service = new OfflineAssetService(repo, passthroughIdentity);

    expect(findReadyJobIdForEpisode(service, "movie-1", 1, 1, { mediaKind: "movie" })).toBe(
      "job-1",
    );
  });

  test("does not serve or badge a different provider-native episode at the same UI position", () => {
    const repo = repositoryStub({
      listTitleAssets: () => [
        asset({
          titleId: "anime-1",
          season: 1,
          episode: 1,
          originJobId: "job-zero",
          providerEpisodeIdentity: { providerId: "allanime", value: "0" },
        }),
        asset({
          titleId: "anime-1",
          season: 1,
          episode: 1,
          originJobId: "job-one",
          providerEpisodeIdentity: { providerId: "allanime", value: "1" },
        }),
      ],
      upsertPlayable: () => asset({ titleId: "anime-1" }),
    });
    const service = new OfflineAssetService(repo, passthroughIdentity);

    expect(
      findReadyJobIdForEpisode(service, "anime-1", 1, 1, {
        mediaKind: "anime",
        providerEpisodeIdentity: { providerId: "allanime", value: "1" },
      }),
    ).toBe("job-one");
    expect(
      findReadyJobIdForEpisode(service, "anime-1", 1, 1, {
        mediaKind: "anime",
        providerEpisodeIdentity: { providerId: "allanime", value: "2" },
      }),
    ).toBeUndefined();
    expect(
      isEpisodeDownloaded(service, "anime-1", 1, 1, {
        providerId: "allanime",
        value: "1",
      }),
    ).toBe(true);
    expect(
      isEpisodeDownloaded(service, "anime-1", 1, 1, {
        providerId: "allanime",
        value: "2",
      }),
    ).toBe(false);
  });
});

describe("findNextReadyEpisode", () => {
  function serviceReturning(next: readonly OfflineAssetRecord[]) {
    const cursorsSeen: Array<readonly OfflineNextReadyCursor[]> = [];
    const repo = repositoryStub({
      listNextReadyByTitleCursors: (cursors) => {
        cursorsSeen.push(cursors);
        return next;
      },
      upsertPlayable: () => asset({ titleId: "t1" }),
    });
    return { service: new OfflineAssetService(repo, passthroughIdentity), cursorsSeen };
  }

  test("answers with the next downloaded episode after the current one", () => {
    const { service, cursorsSeen } = serviceReturning([
      asset({ titleId: "t1", season: 1, episode: 2 }),
    ]);

    expect(findNextReadyEpisode(service, "t1", { season: 1, episode: 1 })).toEqual({
      season: 1,
      episode: 2,
    });
    // The cursor is what scopes the query to "after this episode"; a wrong
    // title id here silently answers null and reads as "series finished".
    expect(cursorsSeen).toEqual([[{ titleId: "t1", season: 1, episode: 1 }]]);
  });

  test("answers null when nothing further is downloaded", () => {
    const { service } = serviceReturning([]);

    expect(findNextReadyEpisode(service, "t1", { season: 1, episode: 13 })).toBeNull();
  });

  test("returns provider-native identity with the next downloaded episode", () => {
    const { service } = serviceReturning([
      asset({
        titleId: "t1",
        season: 1,
        episode: 2,
        providerEpisodeIdentity: { providerId: "allanime", value: "OVA" },
      }),
    ]);

    expect(findNextReadyEpisode(service, "t1", { season: 1, episode: 1 })).toEqual({
      season: 1,
      episode: 2,
      providerEpisodeIdentity: { providerId: "allanime", value: "OVA" },
    });
  });

  test("answers null for an asset carrying no episode axis", () => {
    const { service } = serviceReturning([asset({ titleId: "t1", mediaKind: "movie" })]);

    expect(findNextReadyEpisode(service, "t1", { season: 1, episode: 1 })).toBeNull();
  });

  test("does not query at all without a title id", () => {
    const { service, cursorsSeen } = serviceReturning([
      asset({ titleId: "t1", season: 1, episode: 2 }),
    ]);

    expect(findNextReadyEpisode(service, "", { season: 1, episode: 1 })).toBeNull();
    expect(cursorsSeen).toEqual([]);
  });
});
