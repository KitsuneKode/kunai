import { expect, test } from "bun:test";

import { OfflineAssetService } from "@/services/offline/OfflineAssetService";
import type { DownloadJobRecord, OfflineAssetInput, OfflineAssetRecord } from "@kunai/storage";

/** Identity is not what these tests exercise: keep whatever id the job carried. */
const passthroughIdentity = {
  resolveForTitle: (title: { id: string }) => title.id,
  resolveForJob: (job: { titleId: string }) => job.titleId,
};

function completedJob(patch: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "anilist:1",
    titleName: "Demo",
    mediaKind: "anime",
    season: 1,
    episode: 5,
    providerId: "allanime",
    mode: "anime",
    animeLang: "sub",
    subLang: "en",
    selectedQualityLabel: "1080p",
    streamUrl: "https://provider.invalid/stream",
    headers: { Referer: "https://provider.invalid" },
    status: "completed",
    artifactStatus: "ready",
    progressPercent: 100,
    outputPath: "/tmp/demo-e5.mp4",
    tempPath: "/tmp/demo-e5.tmp",
    retryCount: 0,
    attempt: 1,
    maxAttempts: 3,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:01:00.000Z",
    completedAt: "2026-05-24T00:01:00.000Z",
    ...patch,
  };
}

test("OfflineAssetService adopts completed jobs with exact episode identity but no provider secrets", () => {
  let stored: OfflineAssetRecord | undefined;
  const service = new OfflineAssetService(
    {
      upsertPlayable(input: OfflineAssetInput) {
        stored = {
          ...input,
          id: "asset-1",
          identityKey: "anilist:1:anime:1:5:anime:sub:en:1080p",
          protected: false,
          createdAt: input.updatedAt,
        };
        return stored;
      },
      listByTitleIds: () => (stored ? [stored] : []),
    } as never,
    passthroughIdentity,
  );

  const adopted = service.adoptCompletedJob(
    completedJob({
      providerEpisodeIdentity: { providerId: "allanime", value: "0" },
    }),
  );

  expect(adopted?.filePath).toBe("/tmp/demo-e5.mp4");
  expect(adopted?.providerEpisodeIdentity).toEqual({ providerId: "allanime", value: "0" });
  expect(JSON.stringify(adopted)).not.toContain("streamUrl");
  expect(JSON.stringify(adopted)).not.toContain("Referer");
  expect(service.peekStatusesByTitleIds(["anilist:1"])).toEqual([
    { titleId: "anilist:1", status: "ready" },
  ]);
});

test("OfflineAssetService ignores unfinished download attempts", () => {
  const service = new OfflineAssetService(
    {
      upsertPlayable: () => {
        throw new Error("should not store active jobs");
      },
    } as never,
    passthroughIdentity,
  );

  expect(service.adoptCompletedJob(completedJob({ status: "running" }))).toBeNull();
});

test("OfflineAssetService files an adopted job under the resolved canonical title id", () => {
  // The write path used to store `job.titleId` verbatim while every read
  // canonicalised first, which is how a healthy 13GB download reported
  // "Downloaded file unavailable".
  let stored: OfflineAssetRecord | undefined;
  const service = new OfflineAssetService(
    {
      upsertPlayable(input: OfflineAssetInput) {
        stored = {
          ...input,
          id: "asset-1",
          identityKey: `${input.titleId}:movie`,
          protected: false,
          createdAt: input.updatedAt,
        };
        return stored;
      },
    } as never,
    {
      resolveForTitle: () => "tmdb:1339713",
      resolveForJob: () => "tmdb:1339713",
    },
  );

  const adopted = service.adoptCompletedJob(
    completedJob({ titleId: "1339713", mediaKind: "movie", mode: "series" }),
  );

  expect(adopted?.titleId).toBe("tmdb:1339713");
});

test("OfflineAssetService keeps a repairable sidecar job locally playable", () => {
  let stored: OfflineAssetRecord | undefined;
  const service = new OfflineAssetService(
    {
      upsertPlayable(input: OfflineAssetInput) {
        stored = {
          ...input,
          id: "asset-1",
          identityKey: "repairable-asset",
          protected: false,
          createdAt: input.updatedAt,
        };
        return stored;
      },
    } as never,
    passthroughIdentity,
  );

  const adopted = service.adoptCompletedJob(
    completedJob({ status: "repairable", artifactStatus: "expected-missing" }),
  );

  expect(adopted?.state).toBe("ready");
});
