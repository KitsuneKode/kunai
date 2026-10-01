import { afterAll, expect, test } from "bun:test";

import { DownloadJobsRepository, OfflineAssetsRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

test("pause does not move a job another worker already completed", () => {
  const db = stores.store("download-pause-fence", "data");
  const jobs = new DownloadJobsRepository(db);
  const now = "2026-10-01T00:00:00.000Z";
  jobs.enqueue({
    id: "job-done",
    titleId: "title-1",
    titleName: "Done",
    mediaKind: "series",
    season: 1,
    episode: 1,
    providerId: "videasy",
    mode: "series",
    streamUrl: "https://example.test/a",
    headers: {},
    outputPath: "/tmp/job-done.mp4",
    tempPath: "/tmp/job-done.mp4.part",
    createdAt: now,
    updatedAt: now,
  });
  expect(jobs.markRunning("job-done", now)?.jobId).toBe("job-done");
  jobs.complete("job-done", now);

  expect(jobs.pause("job-done", "late pause", now, now)).toBe(false);
  expect(jobs.get("job-done")?.status).toBe("completed");
});

test("episode 101 is found when the first hundred rows are earlier episodes", () => {
  const db = stores.store("episode-101", "data");
  const jobs = new DownloadJobsRepository(db);
  const assets = new OfflineAssetsRepository(db);
  const now = "2026-10-01T00:00:00.000Z";
  for (let episode = 1; episode <= 101; episode += 1) {
    const id = `job-${episode}`;
    jobs.enqueue({
      id,
      titleId: "long-show",
      titleName: "Long",
      mediaKind: "anime",
      season: 1,
      episode,
      providerId: "allmanga",
      mode: "anime",
      streamUrl: "https://example.test/e",
      headers: {},
      outputPath: `/tmp/${id}.mp4`,
      tempPath: `/tmp/${id}.mp4.part`,
      createdAt: now,
      updatedAt: now,
    });
    assets.upsertPlayable({
      titleId: "long-show",
      titleName: "Long",
      mediaKind: "anime",
      season: 1,
      episode,
      profileKey: "anime:sub:none:best",
      originJobId: id,
      filePath: `/tmp/${id}.mp4`,
      state: "ready",
      byteSize: 10,
      updatedAt: now,
    });
  }

  expect(assets.listTitleAssets("long-show")).toHaveLength(100);
  expect(assets.findReadyOriginJobId("long-show", 1, 101, "anime")).toBe("job-101");
  const next = assets.listNextReadyByTitleCursors([
    { titleId: "long-show", season: 1, episode: 100 },
  ]);
  expect(next[0]?.episode).toBe(101);
  expect(assets.countReadyByTitle("long-show")).toBe(101);

  const plan = db
    .query<{ detail: string }, [string, number, number, number]>(
      `EXPLAIN QUERY PLAN
       SELECT origin_job_id FROM offline_assets
       WHERE title_id = ? AND state = 'ready' AND episode = ?
         AND (season = ? OR (season IS NULL AND ? = 1))`,
    )
    .all("long-show", 101, 1, 1)
    .map((row) => row.detail)
    .join(" ");
  expect(plan).toContain("idx_offline_assets_ready_title");
});

test("a name search finds a ready title past the first page", () => {
  const db = stores.store("library-search", "data");
  const assets = new OfflineAssetsRepository(db);
  for (let index = 0; index < 201; index += 1) {
    const id = `asset-${index}`;
    assets.upsertPlayable({
      titleId: `title-${index}`,
      titleName: index === 0 ? "Needle" : `Show ${index}`,
      mediaKind: "series",
      season: 1,
      episode: 1,
      profileKey: "series:sub:none:best",
      originJobId: undefined,
      filePath: `/tmp/${id}.mp4`,
      state: "ready",
      byteSize: 10,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
  }

  const first = assets.searchReadyByName("Needle", 1);
  expect(first).toHaveLength(1);
  expect(first[0]?.titleName).toBe("Needle");
  const page = assets.searchReadyByName("Show", 50);
  expect(page).toHaveLength(50);
  const last = page[49];
  if (!last) throw new Error("expected a full page");
  const nextPage = assets.searchReadyByName("Show", 50, {
    updatedAt: last.updatedAt,
    id: last.id,
  });
  expect(nextPage[0]?.id).not.toBe(last.id);
  expect(assets.countReadyByTitle("title-200")).toBe(1);
});
