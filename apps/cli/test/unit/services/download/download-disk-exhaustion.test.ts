import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

/**
 * The pre-flight reserve check in `processNextQueued` only sees the volume as
 * it was before the transfer began. When the disk fills *underneath* a running
 * job, the failure arrives as yt-dlp stderr instead — and it used to classify
 * as `unknown`, which is `retryable: true`. The job then re-downloaded the
 * whole file from zero into the same full disk, once per attempt, until the
 * budget was gone: several full transfers spent, several provider requests
 * spent, and a terminal `unknown` failure at the end of it with no indication
 * that the remedy was to free space.
 *
 * The seam here is `resolveDownloadStream`, which is the injectable dependency
 * that reaches the same catch block a failing yt-dlp reaches. The classifier
 * reads a message either way, and `runYtDlpProcess` keeps the tail of stderr
 * (`appendBoundedText` slices `-maxBytes`), so the real fatal write error is
 * present in the string production classifies.
 */
let tempDir: string;
let db: ReturnType<typeof openKunaiDatabase>;
let repo: DownloadJobsRepository;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kunai-download-space-"));
  db = openKunaiDatabase(join(tempDir, "data.sqlite"));
  runMigrations(db, "data");
  repo = new DownloadJobsRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

function buildService(failure: string): DownloadService {
  return new DownloadService({
    repo,
    titleAliases: { upsertAliases() {} },
    config: {
      downloadsEnabled: true,
      downloadPath: join(tempDir, "downloads"),
      offlineArtworkCacheEnabled: false,
      // Zero reserve and a one-byte estimate keep the *pre-flight* check
      // passing, so the test exercises the mid-transfer discovery rather than
      // the admission one it is meant to complement.
      offlineFreeSpaceReserveBytes: 0,
      offlineUnknownEpisodeEstimateBytes: 1,
    } as ConfigService,
    ytDlpAvailable: true,
    ffprobeAvailable: false,
    resolveDownloadStream: () => {
      throw new Error(failure);
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      child() {
        return this;
      },
    },
  });
}

test("a volume that fills mid-transfer defers the job instead of spending its retries", async () => {
  const service = buildService("ERROR: unable to write data: [Errno 28] No space left on device");
  const job = await service.enqueue({
    title: { id: "tmdb:1", type: "series", name: "Frieren" },
    episode: { season: 1, episode: 3, name: "Episode 3" },
    providerId: "allanime",
    mode: "anime",
  });

  await service.processNextQueued();

  const after = repo.get(job.id);
  // `repo.pause` keeps the row queued and defers it through next_retry_at, so
  // the retry window is the signal — the same one the pre-flight reserve pause
  // and the unavailable-folder pause produce.
  expect(after?.status).toBe("queued");
  expect(after?.errorMessage).toContain("ran out of space");

  // The whole point: the attempt budget is untouched, so it is still there
  // once space is freed. Before the fix this was 1 and climbing.
  expect(after?.retryCount).toBe(0);

  // Deferred into the future, not immediately eligible — otherwise the queue
  // would spin on a disk that is still full.
  const retryAt = after?.nextRetryAt ? Date.parse(after.nextRetryAt) : Number.NaN;
  expect(Number.isFinite(retryAt)).toBe(true);
  expect(retryAt).toBeGreaterThan(Date.now());
});

test("an ordinary transient failure still consumes an attempt", async () => {
  // The complement: proving disk-full is deferred is only meaningful if the
  // normal retry lane is untouched by the new branch.
  const service = buildService("Unable to download webpage: connection reset");
  const job = await service.enqueue({
    title: { id: "tmdb:2", type: "series", name: "Frieren" },
    episode: { season: 1, episode: 4, name: "Episode 4" },
    providerId: "allanime",
    mode: "anime",
  });

  await service.processNextQueued();

  const after = repo.get(job.id);
  expect(after?.retryCount).toBe(1);
});
