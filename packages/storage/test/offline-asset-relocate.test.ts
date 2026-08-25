import { afterAll, expect, test } from "bun:test";

import {
  DownloadJobsRepository,
  OfflineAssetsRepository,
  type OfflineAssetInput,
} from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

/**
 * `offline_assets.origin_job_id` is a real foreign key, so every asset needs a
 * download job behind it or the insert fails rather than the assertion.
 */
function harness() {
  const db = stores.store("offline-asset-relocate", "data");
  const jobs = new DownloadJobsRepository(db);
  const assets = new OfflineAssetsRepository(db);

  function addAsset(titleId: string, overrides: Partial<OfflineAssetInput> = {}) {
    const now = new Date().toISOString();
    const originJobId = overrides.originJobId ?? `job-${titleId}`;
    if (!jobs.get(originJobId)) {
      jobs.enqueue({
        id: originJobId,
        titleId,
        titleName: "Obsession",
        mediaKind: "movie",
        season: overrides.season ?? 1,
        episode: overrides.episode ?? 1,
        providerId: "videasy",
        mode: "series",
        streamUrl: "",
        headers: {},
        outputPath: `/tmp/${originJobId}.mp4`,
        tempPath: `/tmp/${originJobId}.mp4.tmp`,
        createdAt: now,
        updatedAt: now,
      });
    }
    return assets.upsertPlayable({
      titleId,
      titleName: "Obsession",
      mediaKind: "movie",
      season: 1,
      episode: 1,
      profileKey: "series:original:none:best",
      filePath: `/tmp/${originJobId}.mp4`,
      state: "ready",
      byteSize: 10,
      updatedAt: now,
      ...overrides,
      originJobId,
    });
  }

  return { assets, addAsset };
}

test("relocating rewrites both the title id and the derived identity key", () => {
  const { assets, addAsset } = harness();
  addAsset("1339713");

  expect(assets.relocateTitleId("1339713", "tmdb:1339713")).toBe(1);

  expect(assets.listTitleAssets("1339713")).toEqual([]);
  const moved = assets.listTitleAssets("tmdb:1339713");
  expect(moved).toHaveLength(1);
  // The identity key is what `upsertPlayable` conflicts on. Leaving it stale
  // would make the next adopt insert a duplicate row for the same file.
  expect(moved[0]?.identityKey).toContain("tmdb:1339713");
});

test("relocating onto an id that already holds the same episode collapses to one row", () => {
  const { assets, addAsset } = harness();
  addAsset("1339713");
  addAsset("tmdb:1339713", { originJobId: "job-canonical" });

  assets.relocateTitleId("1339713", "tmdb:1339713");

  expect(assets.listTitleAssets("tmdb:1339713")).toHaveLength(1);
  expect(assets.listTitleAssets("1339713")).toEqual([]);
});

test("relocating is a no-op when there is nothing to move or the ids match", () => {
  const { assets, addAsset } = harness();
  addAsset("1339713");

  expect(assets.relocateTitleId("nothing-here", "tmdb:1339713")).toBe(0);
  expect(assets.relocateTitleId("1339713", "1339713")).toBe(0);
  expect(assets.listTitleAssets("1339713")).toHaveLength(1);
});

test("listDistinctTitleIds answers each title once", () => {
  const { assets, addAsset } = harness();
  addAsset("1339713");
  addAsset("1339713", { episode: 2, originJobId: "job-b" });
  addAsset("61222", { originJobId: "job-c" });

  expect([...assets.listDistinctTitleIds()].sort()).toEqual(["1339713", "61222"]);
});
