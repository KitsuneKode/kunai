import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

import { waitUntil } from "../../../support/wait-until";

const encoder = new TextEncoder();

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("DownloadService queue hardening", () => {
  let tempDir: string;
  let db: ReturnType<typeof openKunaiDatabase>;
  let repo: DownloadJobsRepository;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-download-hardening-"));
    db = openKunaiDatabase(join(tempDir, "data.sqlite"));
    runMigrations(db, "data");
    repo = new DownloadJobsRepository(db);
    spawnSpy = spyOn(Bun, "spawn");
    spawnSpy.mockImplementation((command: string[]) => {
      throw new Error(
        `DownloadService unit tests must stub Bun.spawn; refusing ${String(command[0] ?? "unknown")}`,
      );
    });
    whichSpy = spyOn(Bun, "which");
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  function buildService(
    overrides: {
      downloadPath?: string;
      statfs?: () => Promise<{ bavail: number; bsize: number }>;
    } = {},
  ): DownloadService {
    // SAFETY: test stub — supplies only the surface this suite exercises.
    const config = {
      downloadsEnabled: true,
      downloadPath: overrides.downloadPath ?? join(tempDir, "downloads"),
      offlineArtworkCacheEnabled: false,
      offlineFreeSpaceReserveBytes: 0,
      offlineUnknownEpisodeEstimateBytes: 1,
    } as ConfigService;
    return new DownloadService({
      repo,
      titleAliases: { upsertAliases() {} },
      config,
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
      statfs: overrides.statfs ?? (async () => ({ bavail: 2 ** 40 / 4096, bsize: 4096 })),
    });
  }

  function stubSuccessfulSpawn(): void {
    spawnSpy.mockImplementation((command: string[]) => {
      const outputPath = command[command.indexOf("-o") + 1]!;
      writeFileSync(outputPath, "published video bytes");
      // SAFETY: Bun.spawn is intercepted; this fixture implements every process member the service reads.
      return {
        stdout: streamOf("[download] 100% of 10MiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
        kill() {},
      } as never;
    });
  }

  async function enqueueMovie(
    service: DownloadService,
    name: string,
    outputDirectory?: string,
  ): Promise<string> {
    const job = await service.enqueue({
      title: { id: `tmdb:${name}`, type: "movie", name },
      stream: { url: `https://example.com/${name}.mp4`, headers: {}, timestamp: 0 },
      providerId: "vidking",
      ...(outputDirectory ? { outputDirectory } : {}),
    });
    return job.id;
  }

  test("a deferred head-of-line job does not idle the worker while work remains", async () => {
    const downloadRoot = join(tempDir, "downloads");
    const otherRoot = join(tempDir, "other");
    const service = buildService({ downloadPath: downloadRoot });
    stubSuccessfulSpawn();
    await enqueueMovie(service, "blocked");
    await enqueueMovie(service, "healthy", otherRoot);

    // The drive goes away after queueing: a regular file where the download
    // root should be, so mkdir throws ENOTDIR on every platform.
    rmSync(downloadRoot, { recursive: true, force: true });
    writeFileSync(downloadRoot, "not a directory");

    // One call must defer the blocked job AND complete the healthy one.
    // Before the drain loop this returned null right after the deferral.
    const result = await service.processNextQueued();
    const healthy = repo.listCompleted(10)[0];
    expect(result?.id).toBe(healthy?.id);

    const blockedRow = repo.listActive(10).find((job) => job.titleId === "tmdb:blocked");
    expect(blockedRow?.status).toBe("queued");
    expect(blockedRow?.nextRetryAt).toBeDefined();
    expect(healthy?.status).toBe("completed");
  });

  test("a kick that lands mid-pass runs a follow-up pass instead of being dropped", async () => {
    const service = buildService();
    let releaseFirst!: (code: number) => void;
    let calls = 0;
    spawnSpy.mockImplementation((command: string[]) => {
      calls += 1;
      const outputPath = command[command.indexOf("-o") + 1]!;
      if (calls === 1) {
        // SAFETY: Bun.spawn is intercepted; hang is released deterministically below.
        return {
          stdout: streamOf(""),
          stderr: streamOf(""),
          exited: new Promise<number>((resolve) => {
            releaseFirst = (code: number) => {
              writeFileSync(outputPath, "video-bytes-1");
              resolve(code);
            };
          }),
          kill() {},
        } as never;
      }
      writeFileSync(outputPath, "video-bytes-2");
      // SAFETY: Bun.spawn is intercepted; this fixture implements every process member the service reads.
      return {
        stdout: streamOf("[download] 100%\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
        kill() {},
      } as never;
    });

    const firstId = await enqueueMovie(service, "first");
    const pass = service.processQueue();
    await waitUntil(() => repo.get(firstId)?.status === "running", { label: "first job running" });

    // Lands while the first pass is still holding the worker: without
    // coalescing this kick is silently dropped and the second job waits for
    // the next external nudge that may never come.
    const secondId = await enqueueMovie(service, "second");
    service.kickQueue("download-manager");
    releaseFirst(0);
    await pass;
    await waitUntil(() => repo.get(secondId)?.status === "completed", {
      label: "second job completed via coalesced pass",
    });
    expect(repo.get(firstId)?.status).toBe("completed");
  });

  test("shutdown before selection returns without starting work", async () => {
    const service = buildService();
    stubSuccessfulSpawn();
    const id = await enqueueMovie(service, "quiet");
    service.beginShutdown();
    expect(await service.processNextQueued()).toBeNull();
    expect(repo.get(id)?.status).toBe("queued");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("shutdown during the storage probe requeues instead of downloading", async () => {
    let probeGate: (() => Promise<{ bavail: number; bsize: number }>) | null = null;
    const healthy = async () => ({ bavail: 2 ** 40 / 4096, bsize: 4096 });
    const service = buildService({
      statfs: () => (probeGate ? probeGate() : healthy()),
    });
    stubSuccessfulSpawn();
    const id = await enqueueMovie(service, "probe-race");

    let releaseProbe!: (stats: { bavail: number; bsize: number }) => void;
    let probeReached = false;
    probeGate = () => {
      probeReached = true;
      return new Promise<{ bavail: number; bsize: number }>((resolve) => {
        releaseProbe = resolve;
      });
    };
    const pending = service.processNextQueued();
    await waitUntil(() => probeReached, { label: "worker reached storage probe" });
    service.beginShutdown();
    releaseProbe({ bavail: 2 ** 40 / 4096, bsize: 4096 });
    expect(await pending).toBeNull();
    expect(repo.get(id)?.status).toBe("queued");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("a lost first heartbeat skips the download instead of running leaseless", async () => {
    const service = buildService();
    stubSuccessfulSpawn();
    const id = await enqueueMovie(service, "lease-check");
    const heartbeat = spyOn(repo, "markHeartbeat");
    heartbeat.mockImplementationOnce(() => false);

    // The lease is gone before the first beat, so no download may start.
    // The row stays running under its (mocked-away) owner for lease recovery;
    // what matters here is spawn is never called without a live heartbeat.
    const result = await service.processNextQueued();
    heartbeat.mockRestore();
    expect(result).toBeNull();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(repo.get(id)?.status).toBe("running");
  });

  test("deferral stamps land inside the window plus bounded jitter", async () => {
    const downloadRoot = join(tempDir, "downloads");
    const service = buildService({ downloadPath: downloadRoot });
    stubSuccessfulSpawn();
    await enqueueMovie(service, "deferred");
    rmSync(downloadRoot, { recursive: true, force: true });
    writeFileSync(downloadRoot, "not a directory");

    const before = Date.now();
    expect(await service.processNextQueued()).toBeNull();
    const retryAt = repo.listActive(10)[0]?.nextRetryAt;
    expect(retryAt).toBeDefined();
    const retryMs = Date.parse(retryAt!);
    expect(Number.isFinite(retryMs)).toBe(true);
    expect(retryMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(retryMs).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 60_000);
  });

  test("a database failure during admission rejects instead of deferring", async () => {
    const service = buildService();
    stubSuccessfulSpawn();
    const id = await enqueueMovie(service, "db-outage");
    const listActive = spyOn(repo, "listActive");
    listActive.mockImplementation(() => {
      throw new Error("db locked");
    });

    // Codeless database errors are worker rejections, not unavailable
    // folders: they must reach the supervisor, never the deferral lane.
    await expect(service.processNextQueued()).rejects.toThrow("db locked");
    expect(repo.get(id)?.status).toBe("queued");
    expect(repo.get(id)?.nextRetryAt).toBeUndefined();
    // The claim is released on the way out: a second attempt rejects the
    // same way instead of skipping a stranded id forever.
    await expect(service.processNextQueued()).rejects.toThrow("db locked");
    listActive.mockRestore();
  });

  test("a retryable transfer failure reschedules instead of failing", async () => {
    const service = buildService();
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffprobe") throw new Error("unreachable with ffprobe disabled");
      // SAFETY: Bun.spawn is intercepted; nonzero exit drives the retry path.
      return {
        stdout: streamOf(""),
        stderr: streamOf("ERROR: HTTP Error 503: Service Unavailable"),
        exited: Promise.resolve(1),
        kill() {},
      } as never;
    });
    const id = await enqueueMovie(service, "flaky");

    const before = Date.now();
    const result = await service.processNextQueued();
    expect(result?.status).toBe("queued");
    const retryAt = repo.get(id)?.nextRetryAt;
    expect(retryAt).toBeDefined();
    const retryMs = Date.parse(retryAt!);
    expect(retryMs).toBeGreaterThanOrEqual(before + 2_000);
    expect(retryMs).toBeLessThanOrEqual(before + 2_000 + 60_000);
  });
});
