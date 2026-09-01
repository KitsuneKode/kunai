import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

/**
 * `resumeEligiblePausedJobs` reads as dead code and is not.
 *
 * Its requeue looks unreachable: `listPaused` selects `next_retry_at > now`,
 * and the loop then requeues only when `retryAt <= now`. Those are disjoint for
 * every well-formed timestamp, so a reviewer reasonably concludes the function
 * never fires and deletes it.
 *
 * The reachable case is a *corrupt* `next_retry_at`. SQL compares that column
 * as a string, so `not-a-date` sorts above any ISO timestamp and is returned;
 * `Date.parse` then yields NaN, the `!Number.isFinite` arm fires, and the row
 * is healed. `selectEligibleQueuedJob` cannot do this — it requires a finite,
 * elapsed timestamp, so it skips such a row for the life of the install.
 *
 * This test exists so the deletion fails loudly instead of quietly stranding
 * every job that ever gets a bad timestamp written to it.
 */
let tempDir: string;
let db: ReturnType<typeof openKunaiDatabase>;
let repo: DownloadJobsRepository;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kunai-paused-recovery-"));
  db = openKunaiDatabase(join(tempDir, "data.sqlite"));
  runMigrations(db, "data");
  repo = new DownloadJobsRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

function buildService(): DownloadService {
  return new DownloadService({
    repo,
    titleAliases: { upsertAliases() {} },
    config: {
      downloadsEnabled: true,
      downloadPath: join(tempDir, "downloads"),
      offlineArtworkCacheEnabled: false,
      offlineFreeSpaceReserveBytes: 0,
      offlineUnknownEpisodeEstimateBytes: 1,
    } as ConfigService,
    ytDlpAvailable: true,
    ffprobeAvailable: false,
    // Fail the transfer immediately: this test is about job selection, and a
    // resolver that throws keeps it off the network entirely.
    resolveDownloadStream: () => {
      throw new Error("resolver unavailable for this test");
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

test("a corrupt next_retry_at is healed instead of stranding the job forever", async () => {
  const service = buildService();
  const job = await service.enqueue({
    title: { id: "tmdb:1", type: "series", name: "Frieren" },
    episode: { season: 1, episode: 3, name: "Episode 3" },
    providerId: "allanime",
    mode: "anime",
  });

  db.query(
    "UPDATE download_jobs SET status = 'queued', next_retry_at = 'not-a-date' WHERE id = ?",
  ).run(job.id);
  expect(repo.get(job.id)?.nextRetryAt).toBe("not-a-date");

  await service.processQueue();

  const healed = repo.get(job.id);
  // The corrupt window is gone. It is not `undefined`: the heal requeues the
  // row, the same pass then selects and attempts it, and the failing resolver
  // schedules a fresh retry — which is the proof it became reachable at all.
  expect(healed?.nextRetryAt).not.toBe("not-a-date");
  expect(Number.isFinite(Date.parse(healed?.nextRetryAt ?? ""))).toBe(true);
  // Attempted, not merely re-timestamped. Without the heal this stays 0
  // forever because `selectEligibleQueuedJob` can never pick the row.
  expect(healed?.retryCount).toBe(1);
});

test("a genuinely deferred job keeps its retry window", async () => {
  // The complement, and the reason the heal cannot simply requeue everything
  // `listPaused` returns: a disk-full or unavailable-folder pause must stay
  // deferred, not be resumed on the next queue pass.
  const service = buildService();
  const job = await service.enqueue({
    title: { id: "tmdb:2", type: "series", name: "Frieren" },
    episode: { season: 1, episode: 4, name: "Episode 4" },
    providerId: "allanime",
    mode: "anime",
  });

  const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  repo.pause(job.id, "deferred", retryAt, new Date().toISOString());

  await service.processQueue();

  expect(repo.get(job.id)?.nextRetryAt).toBe(retryAt);
});
