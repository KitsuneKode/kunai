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
});
