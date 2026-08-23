import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

/**
 * `processNextQueued` claims a job into the in-memory `claimedJobIds` set
 * before it prepares the output directory. `evaluateStorageForPath` runs mkdir
 * + statfs, which throw when the download folder is unwritable, unmounted, or
 * not a directory — an unplugged external drive or a dropped network share.
 *
 * That throw escaped past the claim, with two consequences:
 *   - `selectEligibleQueuedJob` skips claimed ids, and `claimedJobIds` is
 *     process-lifetime state, so the job became unstartable until restart while
 *     still displaying as queued.
 *   - production callers used to discard `downloadService.processQueue()` with
 *     no catch, so it surfaced as an unhandled rejection, which `main.ts`
 *     escalates to a fatal shutdown.
 *
 * The unavailable path is simulated with a regular *file* where the download
 * directory should be. `chmod` would be the obvious choice and is the wrong
 * one: it is a no-op for root and effectively unenforced on Windows, so the
 * test would quietly stop testing anything on two of three platforms.
 */
let tempDir: string;
let db: ReturnType<typeof openKunaiDatabase>;
let repo: DownloadJobsRepository;
let whichSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kunai-download-path-"));
  db = openKunaiDatabase(join(tempDir, "data.sqlite"));
  runMigrations(db, "data");
  repo = new DownloadJobsRepository(db);
  whichSpy = spyOn(Bun, "which");
});

afterEach(() => {
  whichSpy.mockRestore();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

function buildService(downloadPath: string): DownloadService {
  return new DownloadService({
    repo,
    titleAliases: { upsertAliases() {} },
    config: {
      downloadsEnabled: true,
      downloadPath,
      offlineArtworkCacheEnabled: false,
      offlineFreeSpaceReserveBytes: 0,
      offlineUnknownEpisodeEstimateBytes: 1,
    } as ConfigService,
    ytDlpAvailable: true,
    ffprobeAvailable: false,
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

test("an unavailable download folder does not strand the job or reject", async () => {
  // Queue while the folder is healthy — `enqueue` prepares the directory too,
  // so the failure has to arrive afterwards. That is also the real sequence:
  // the drive is present when you queue and gone when the worker gets there.
  const downloadRoot = join(tempDir, "downloads");
  const service = buildService(downloadRoot);
  const job = await service.enqueue({
    title: { id: "tmdb:1", type: "series", name: "Frieren" },
    episode: { season: 1, episode: 3, name: "Episode 3" },
    providerId: "allanime",
    mode: "anime",
  });

  // Now the drive goes away: replace the download root with a regular file, so
  // mkdir(recursive) underneath it throws on Linux, macOS and Windows alike.
  rmSync(downloadRoot, { recursive: true, force: true });
  writeFileSync(downloadRoot, "not a directory");

  // Must resolve, not reject: this path is a classified per-job condition, not
  // an unexpected queue-pass failure for the supervisor to contain and report.
  const first = await service.processNextQueued();
  expect(first).toBeNull();

  // Deferred with a readable reason rather than left running or lost.
  // `repo.pause` keeps status 'queued' and defers via next_retry_at, so the
  // retry window is the signal here — not a 'paused' status.
  const after = repo.get(job.id);
  expect(after?.status).toBe("queued");
  expect(after?.nextRetryAt).toBeDefined();
  expect(after?.errorMessage).toContain("download folder is unavailable");

  // Clear the retry window and prove a later pass still *selects* the job.
  // This is the leak check: `claimedJobIds` is process-lifetime state and
  // `selectEligibleQueuedJob` skips claimed ids, so before the fix this second
  // pass could never reach the job again and it stayed queued forever with no
  // retry window and no error.
  repo.requeue(job.id, new Date().toISOString());
  expect(repo.get(job.id)?.nextRetryAt).toBeUndefined();

  const second = await service.processNextQueued();
  expect(second).toBeNull();

  const afterSecond = repo.get(job.id);
  expect(afterSecond?.nextRetryAt).toBeDefined();
  expect(afterSecond?.errorMessage).toContain("download folder is unavailable");
});
