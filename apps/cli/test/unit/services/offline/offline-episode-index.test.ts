import { describe, expect, test } from "bun:test";

import {
  downloadedCountForTitle,
  findNextReadyEpisode,
  findReadyJobIdForEpisode,
  isEpisodeDownloaded,
} from "@/services/offline/offline-episode-index";
import { OfflineAssetService } from "@/services/offline/OfflineAssetService";
import type { OfflineAssetRecord, OfflineAssetsRepository } from "@kunai/storage";

/** Identity is not what these tests exercise: keep whatever id the job carried. */
const passthroughIdentity = {
  resolveForTitle: (title: { id: string }) => title.id,
  resolveForJob: (job: { titleId: string }) => job.titleId,
};

function asset(partial: Partial<OfflineAssetRecord> & Pick<OfflineAssetRecord, "titleId">) {
  return {
    id: partial.id ?? `asset-${partial.titleId}`,
    titleId: partial.titleId,
    titleName: partial.titleName ?? "Demo",
    mediaKind: partial.mediaKind ?? "series",
    season: partial.season,
    episode: partial.episode,
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
  } as OfflineAssetRecord;
}

describe("offline-episode-index", () => {
  test("isEpisodeDownloaded and downloadedCountForTitle read ready assets", () => {
    const repo = {
      get: () => undefined,
      listTitleAssets: () => [
        asset({ titleId: "t1", season: 1, episode: 1 }),
        asset({ titleId: "t1", season: 1, episode: 2, state: "missing" }),
        asset({ titleId: "t1", season: 1, episode: 3 }),
      ],
      listByTitleIds: () => [],
      listNextReadyByTitleCursors: () => [],
      markValidation: () => {},
      upsertPlayable: () => asset({ titleId: "t1" }),
    } as unknown as OfflineAssetsRepository;
    const service = new OfflineAssetService(repo, passthroughIdentity);

    expect(isEpisodeDownloaded(service, "t1", 1, 1)).toBe(true);
    expect(isEpisodeDownloaded(service, "t1", 1, 2)).toBe(false);
    expect(downloadedCountForTitle(service, "t1")).toBe(2);
  });

  test("finds downloaded movies without inventing an episode axis", () => {
    const repo = {
      get: () => undefined,
      listTitleAssets: () => [asset({ titleId: "movie-1", mediaKind: "movie" })],
      listByTitleIds: () => [],
      listNextReadyByTitleCursors: () => [],
      markValidation: () => {},
      upsertPlayable: () => asset({ titleId: "movie-1", mediaKind: "movie" }),
    } as unknown as OfflineAssetsRepository;
    const service = new OfflineAssetService(repo, passthroughIdentity);

    expect(findReadyJobIdForEpisode(service, "movie-1", 1, 1, { mediaKind: "movie" })).toBe(
      "job-1",
    );
  });
});

describe("findNextReadyEpisode", () => {
  function serviceReturning(next: readonly OfflineAssetRecord[]) {
    const cursorsSeen: unknown[] = [];
    const repo = {
      get: () => undefined,
      listTitleAssets: () => [],
      listByTitleIds: () => [],
      listNextReadyByTitleCursors: (cursors: unknown) => {
        cursorsSeen.push(cursors);
        return next;
      },
      markValidation: () => {},
      upsertPlayable: () => asset({ titleId: "t1" }),
    } as unknown as OfflineAssetsRepository;
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
