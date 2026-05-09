import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadEnqueueRejectedError, DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

const encoder = new TextEncoder();

describe("DownloadService", () => {
  let tempDir: string;
  let repo: DownloadJobsRepository;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-download-service-"));
    const db = openKunaiDatabase(join(tempDir, "data.sqlite"));
    runMigrations(db, "data");
    repo = new DownloadJobsRepository(db);
    spawnSpy = spyOn(Bun, "spawn");
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  test("rejects enqueue when downloads are disabled", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: false,
      ffmpegAvailable: true,
      downloadPath: tempDir,
    });

    await expect(
      service.enqueue({
        title: { id: "tmdb:1", type: "series", name: "Example" },
        episode: { season: 1, episode: 1, name: "Episode 1" },
        stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
        providerId: "vidking",
      }),
    ).rejects.toBeInstanceOf(DownloadEnqueueRejectedError);
  });

  test("processes successful queue entries", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const outputPath = command[command.length - 1];
      if (typeof outputPath === "string") {
        writeFileSync(outputPath, "video-bytes");
      }
      return {
        stdout: streamOf("progress=continue\nout_time_ms=1000000\nprogress=end\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: {
        url: "https://example.com/master.m3u8",
        headers: { Referer: "https://example.com" },
        timestamp: 0,
      },
      providerId: "vidking",
    });
    await service.processQueue();

    expect(service.listCompleted(10).some((entry) => entry.id === job.id)).toBe(true);
  });

  test("stores durable intent and resolves a fresh stream before processing", async () => {
    const resolvedUrls: string[] = [];
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async (intent) => {
        resolvedUrls.push(`${intent.providerId}:${intent.title.id}:${intent.episode?.episode}`);
        return {
          stream: {
            url: "https://fresh.example/master.m3u8",
            headers: { Referer: "https://fresh.example" },
            timestamp: 0,
          },
          providerId: intent.providerId,
          selectionChanged: false,
        };
      },
    });
    spawnSpy.mockImplementation((command: string[]) => {
      expect(command.join(" ")).toContain("https://fresh.example/master.m3u8");
      const outputPath = command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("progress=end\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 3, name: "Episode 3" },
      providerId: "vidking",
      mode: "series",
      subLang: "eng",
      animeLang: "sub",
    });
    await service.processQueue();

    const completed = repo.get(job.id);
    expect(resolvedUrls).toEqual(["vidking:tmdb:1:3"]);
    expect(completed?.status).toBe("completed");
    expect(completed?.streamUrl).toBe("https://fresh.example/master.m3u8");
    expect(completed?.mode).toBe("series");
    expect(completed?.subLang).toBe("eng");
  });

  test("marks zero-byte artifacts invalid instead of completed", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
      abortGraceMs: 1,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const outputPath = command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "");
      return {
        stdout: streamOf("progress=end\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    await service.processQueue();

    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureKind).toBe("artifact-invalid");
    expect(reloaded?.artifactStatus).toBe("invalid-file");
  });

  test("uses per-job destination override", async () => {
    const customDir = join(tempDir, "custom-destination");
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: join(tempDir, "default"),
    });

    const job = await service.enqueue({
      title: { id: "tmdb:2", type: "movie", name: "Custom Movie" },
      episode: { season: 1, episode: 1 },
      stream: { url: "https://example.com/movie.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      outputDirectory: customDir,
    });

    expect(job.outputPath.startsWith(customDir)).toBe(true);
    expect(existsSync(customDir)).toBe(true);
  });

  test("schedules retry for transient failures", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation(
      () =>
        ({
          stdout: streamOf(""),
          stderr: streamOf("connection timed out"),
          exited: Promise.resolve(1),
        }) as never,
    );

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    await service.processQueue();

    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("queued");
    expect(reloaded?.retryCount).toBe(1);
    expect(reloaded?.nextRetryAt).toBeDefined();
  });

  test("aborts active process and marks job aborted", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
    });

    let resolveExit: ((code: number) => void) | null = null;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const killSignals: unknown[] = [];
    spawnSpy.mockImplementation(
      () =>
        ({
          stdout: streamOf(""),
          stderr: streamOf(""),
          exited,
          kill: (signal?: unknown) => {
            killSignals.push(signal);
            if (signal === "SIGKILL") resolveExit?.(1);
          },
        }) as never,
    );

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });

    const running = service.processQueue();
    await Bun.sleep(10);
    await service.abort(job.id);
    await running;

    expect(repo.get(job.id)?.status).toBe("aborted");
    expect(killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("pauses active downloads for shutdown and leaves them retryable", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
      abortGraceMs: 1,
    });

    let resolveExit: ((code: number) => void) | null = null;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    spawnSpy.mockImplementation(
      () =>
        ({
          stdout: streamOf(""),
          stderr: streamOf(""),
          exited,
          kill: (signal?: unknown) => {
            if (signal === "SIGKILL") resolveExit?.(1);
          },
        }) as never,
    );

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });

    const running = service.processQueue();
    await Bun.sleep(10);
    await service.pauseActiveJobsForShutdown("download paused by test shutdown");
    await running;

    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("queued");
    expect(reloaded?.errorMessage).toBe("download paused by test shutdown");
    expect(reloaded?.nextRetryAt).toBeDefined();
  });

  test("does not schedule retry for terminal failures", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation(
      () =>
        ({
          stdout: streamOf(""),
          stderr: streamOf("ffmpeg: invalid argument\n"),
          exited: Promise.resolve(1),
        }) as never,
    );

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    await service.processQueue();

    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureKind).toBe("ffmpeg-config");
    expect(reloaded?.retryCount).toBe(1);
  });
});

function buildService({
  repo,
  downloadsEnabled,
  ffmpegAvailable,
  downloadPath,
  resolveDownloadStream,
  abortGraceMs,
}: {
  repo: DownloadJobsRepository;
  downloadsEnabled: boolean;
  ffmpegAvailable: boolean;
  downloadPath: string;
  resolveDownloadStream?: ConstructorParameters<typeof DownloadService>[0]["resolveDownloadStream"];
  abortGraceMs?: number;
}): DownloadService {
  return new DownloadService({
    repo,
    config: {
      downloadsEnabled,
      downloadPath,
    } as ConfigService,
    ffmpegAvailable,
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
    resolveDownloadStream,
    abortGraceMs,
  });
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
