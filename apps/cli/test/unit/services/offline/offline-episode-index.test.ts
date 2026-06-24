import { describe, expect, test } from "bun:test";

import {
  downloadedCountForTitle,
  isEpisodeDownloaded,
} from "@/services/offline/offline-episode-index";
import { OfflineAssetService } from "@/services/offline/OfflineAssetService";
import type { OfflineAssetRecord, OfflineAssetsRepository } from "@kunai/storage";

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
    const service = new OfflineAssetService(repo);

    expect(isEpisodeDownloaded(service, "t1", 1, 1)).toBe(true);
    expect(isEpisodeDownloaded(service, "t1", 1, 2)).toBe(false);
    expect(downloadedCountForTitle(service, "t1")).toBe(2);
  });
});
