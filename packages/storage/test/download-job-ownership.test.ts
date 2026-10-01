import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";

import { DownloadJobsRepository, openKunaiDatabase } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

function enqueue(
  jobs: DownloadJobsRepository,
  id: string,
  createdAt: string,
  nextRetryAt?: string,
): void {
  jobs.enqueue({
    id,
    titleId: `title-${id}`,
    titleName: id,
    mediaKind: "series",
    season: 1,
    episode: 1,
    providerId: "videasy",
    mode: "series",
    streamUrl: "https://example.test/a",
    headers: {},
    outputPath: `/tmp/${id}.mp4`,
    tempPath: `/tmp/${id}.mp4.part`,
    createdAt,
    updatedAt: createdAt,
  });
  if (nextRetryAt) {
    jobs.deferQueued(id, "not yet", nextRetryAt, createdAt);
  }
}

test("a due job is selected ahead of fifty deferred jobs created earlier", () => {
  const jobs = new DownloadJobsRepository(stores.store("due-before-limit", "data"));
  const earlier = "2026-10-01T00:00:00.000Z";
  const now = "2026-10-01T12:00:00.000Z";
  for (let index = 1; index <= 50; index += 1) {
    enqueue(jobs, `deferred-${index}`, earlier, "2026-10-02T00:00:00.000Z");
  }
  enqueue(jobs, "due-now", now);

  expect(jobs.listDueQueued(now, 1).map((job) => job.id)).toEqual(["due-now"]);
});

test("a recovered lease rejects the previous owner's completion", () => {
  const dir = stores.dir("two-connections");
  const firstDb = stores.db(dir);
  const secondDb = openKunaiDatabase(join(dir, "data.sqlite"));
  const first = new DownloadJobsRepository(firstDb);
  const second = new DownloadJobsRepository(secondDb);
  const now = "2026-10-01T00:00:00.000Z";
  const later = "2026-10-01T00:05:00.000Z";
  enqueue(first, "shared-job", now);

  const claim = first.markRunning("shared-job", now);
  expect(claim?.stagingDir).toBe("/tmp/shared-job.mp4.part.claim-1");
  const recovered = second.claimRunningForRecovery("shared-job", now, later);
  expect(recovered?.generation).toBe(2);
  expect(recovered?.stagingDir).not.toBe(claim?.stagingDir);

  expect(first.complete("shared-job", later, claim)).toBe(false);
  expect(first.get("shared-job")?.status).toBe("running");
  expect(second.complete("shared-job", later, recovered)).toBe(true);
  expect(second.get("shared-job")?.status).toBe("completed");
  expect(second.get("shared-job")?.ownerToken).toBeUndefined();
  secondDb.close(true);
});
