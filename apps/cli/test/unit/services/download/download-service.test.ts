import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadEnqueueRejectedError, DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

describe("DownloadService", () => {
  let tempDir: string;
  let repo: DownloadJobsRepository;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-download-service-"));
    const db = openKunaiDatabase(join(tempDir, "data.sqlite"));
    runMigrations(db, "data");
    repo = new DownloadJobsRepository(db);
    spawnSpy = spyOn(Bun, "spawn");
    whichSpy = spyOn(Bun, "which");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  test("rejects enqueue when downloads are disabled", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: true,
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

  test("rejects a duplicate episode intent through the indexed admission guard", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const input = {
      title: { id: "tmdb:1", type: "series" as const, name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      providerId: "vidking",
    };

    await service.enqueue(input);
    await expect(service.enqueue(input)).rejects.toMatchObject({ code: "duplicate-intent" });
    expect(repo.listQueued(10)).toHaveLength(1);
  });

  test("processes successful queue entries", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") {
        writeFileSync(outputPath, "video-bytes");
      }
      return {
        stdout: streamOf("[download]  50.0% of 1.2GiB\n[download] 100% of 1.2GiB\n"),
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

  test("rechecks disk capacity before starting queued work", async () => {
    let reserveBytes = 0;
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      configService: {
        downloadsEnabled: true,
        downloadPath: tempDir,
        get offlineFreeSpaceReserveBytes() {
          return reserveBytes;
        },
        offlineUnknownEpisodeEstimateBytes: 1,
      } as ConfigService,
    });
    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    reserveBytes = Number.MAX_SAFE_INTEGER;

    await service.processQueue();

    expect(spawnSpy).not.toHaveBeenCalled();
    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("queued");
    expect(reloaded?.nextRetryAt).toBeDefined();
    expect(reloaded?.errorMessage).toContain("offline safety reserve");
  });

  test("persists provider source and stream selection for exact re-resolve", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
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
      selectedSourceId: "source-b",
      selectedStreamId: "stream-b-1080",
      selectedQualityLabel: "1080p",
    });

    const stored = repo.get(job.id);
    expect(stored?.selectedSourceId).toBe("source-b");
    expect(stored?.selectedStreamId).toBe("stream-b-1080");
    expect(stored?.selectedQualityLabel).toBe("1080p");
  });

  test("persists artifact duration when ffprobe validation succeeds", async () => {
    const diagnostics: unknown[] = [];
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      ffprobeAvailable: true,
      downloadPath: tempDir,
      diagnostics: {
        record: (event: unknown) => diagnostics.push(event),
      },
    });
    whichSpy.mockImplementation((name: string) => (name === "ffprobe" ? "/usr/bin/ffprobe" : null));
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffprobe") {
        return {
          stdout: streamOf("1500.25\n"),
          stderr: streamOf(""),
          exited: Promise.resolve(0),
        } as never;
      }
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") {
        writeFileSync(outputPath, "video-bytes");
      }
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
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

    const completed = repo.get(job.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.durationMs).toBe(1_500_250);
    expect(completed?.fileSize).toBeGreaterThan(0);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        category: "download",
        operation: "download.artifact.validated",
        message: "Download artifact validated",
        context: expect.objectContaining({
          jobId: job.id,
          durationMs: 1_500_250,
        }),
      }),
    );
  });

  test("carries poster metadata and generates a thumbnail when ffmpeg is available", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      ffmpegAvailable: true,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffmpeg") {
        const outputPath = command.at(-1);
        if (typeof outputPath === "string") writeFileSync(outputPath, "jpeg-bytes");
        return {
          stdout: streamOf(""),
          stderr: streamOf(""),
          exited: Promise.resolve(0),
        } as never;
      }
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") {
        writeFileSync(outputPath, "video-bytes");
      }
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: {
        id: "tmdb:1",
        type: "series",
        name: "Example",
        posterUrl: "https://img.example/poster.jpg",
      },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    await service.processQueue();
    await waitUntil(() => repo.get(job.id)?.thumbnailPath !== undefined);

    const completed = repo.get(job.id);
    expect(completed?.posterUrl).toBe("https://img.example/poster.jpg");
    expect(completed?.thumbnailPath).toBeDefined();
    expect(existsSync(completed?.thumbnailPath ?? "")).toBe(true);
  });

  test("stores durable intent and resolves a fresh stream before processing", async () => {
    const resolvedUrls: string[] = [];
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
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
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 3, name: "Episode 3" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "eng",
    });
    await service.processQueue();

    const completed = repo.get(job.id);
    expect(resolvedUrls).toEqual(["vidking:tmdb:1:3"]);
    expect(completed?.status).toBe("completed");
    expect(completed?.streamUrl).toBe("https://fresh.example/master.m3u8");
    expect(completed?.mode).toBe("series");
    expect(completed?.subLang).toBe("eng");
  });

  test("downloads subtitles from the freshly resolved stream metadata", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async () => ({
        stream: {
          url: "https://fresh.example/master.m3u8",
          headers: { Referer: "https://fresh.example" },
          timestamp: 0,
          subtitle: "https://fresh.example/subs/en.vtt?q=selected",
          subtitleList: [
            {
              url: "https://fresh.example/subs/en.vtt?q=inventory",
              language: "en",
              display: "English",
            },
          ],
        },
        providerId: "vidking",
        selectionChanged: false,
      }),
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    globalThis.fetch = mock(
      async () => new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi"),
    ) as unknown as typeof fetch;

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 3, name: "Episode 3" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    await service.processQueue();

    const completed = repo.get(job.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.subtitleUrl).toBe("https://fresh.example/subs/en.vtt?q=selected");
    expect(completed?.subtitleLanguage).toBe("en");
    expect(completed?.subtitlePath).toBeDefined();
    expect(existsSync(completed?.subtitlePath ?? "")).toBe(true);
  });

  test("clears stale subtitle metadata when a refreshed stream has no subtitles", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async () => ({
        stream: {
          url: "https://fresh.example/master.m3u8",
          headers: {},
          timestamp: 0,
        },
        providerId: "vidking",
        selectionChanged: false,
      }),
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    globalThis.fetch = mock(async () => {
      throw new Error("stale subtitle URL should not be fetched");
    }) as unknown as typeof fetch;

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 4, name: "Episode 4" },
      stream: {
        url: "https://stale.example/master.m3u8",
        headers: {},
        timestamp: 0,
        subtitle: "https://stale.example/subs/en.vtt",
      },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    const staleSubtitlePath = join(tempDir, "old-sidecar.vtt");
    writeFileSync(staleSubtitlePath, "old subtitle");
    repo.updateOfflineMetadata(
      job.id,
      { subtitlePath: staleSubtitlePath, subtitleLanguage: "en" },
      new Date().toISOString(),
    );
    await service.processQueue();

    const completed = repo.get(job.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.subtitleUrl).toBeUndefined();
    expect(completed?.subtitlePath).toBeUndefined();
    expect(completed?.subtitleLanguage).toBeUndefined();
  });

  test("completes hardsub downloads without requiring an external subtitle sidecar", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    globalThis.fetch = mock(async () => {
      throw new Error("hardsub downloads must not fetch an external subtitle sidecar");
    }) as unknown as typeof fetch;

    const job = await service.enqueue({
      title: { id: "anime:1", type: "series", name: "Example Anime" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: {
        url: "https://example.com/hardsub.m3u8",
        headers: {},
        timestamp: 0,
        hardSubLanguage: "en",
      },
      providerId: "allanime",
      mode: "anime",
      audioPreference: "sub",
      subtitlePreference: "en",
    });
    await service.processQueue();

    const completed = repo.get(job.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.subtitleLanguage).toBe("en");
    expect(completed?.subtitlePath).toBeUndefined();
  });

  test("keeps completed video repairable when an expected subtitle sidecar fails", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async () => ({
        stream: {
          url: "https://fresh.example/master.m3u8",
          headers: { Referer: "https://fresh.example" },
          timestamp: 0,
          subtitle: "https://fresh.example/subs/en.vtt",
          subtitleList: [{ url: "https://fresh.example/subs/en.vtt", language: "en" }],
        },
        providerId: "vidking",
        selectionChanged: false,
      }),
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    globalThis.fetch = mock(
      async () => new Response("", { status: 503 }),
    ) as unknown as typeof fetch;

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 5, name: "Episode 5" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    await service.processQueue();

    const repairable = repo.get(job.id);
    expect(repairable?.status).toBe("repairable");
    expect(repairable?.artifactStatus).toBe("expected-missing");
    expect(repairable?.repairMetadataJson).toContain("subtitle");
    expect(existsSync(repairable?.outputPath ?? "")).toBe(true);
  });

  test("repairs missing subtitle sidecars without re-downloading the video", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async () => ({
        stream: {
          url: "https://fresh.example/master.m3u8",
          headers: { Referer: "https://fresh.example" },
          timestamp: 0,
          subtitle: "https://fresh.example/subs/en.vtt",
          subtitleList: [{ url: "https://fresh.example/subs/en.vtt", language: "en" }],
        },
        providerId: "vidking",
        selectionChanged: false,
      }),
    });
    let ytDlpCalls = 0;
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] !== "yt-dlp") {
        return { stdout: streamOf(""), stderr: streamOf(""), exited: Promise.resolve(0) } as never;
      }
      ytDlpCalls += 1;
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    let subtitleAttempts = 0;
    globalThis.fetch = mock(async () => {
      subtitleAttempts += 1;
      if (subtitleAttempts === 1) return new Response("", { status: 503 });
      return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi");
    }) as unknown as typeof fetch;

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 6, name: "Episode 6" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    await service.processQueue();
    expect(repo.get(job.id)?.status).toBe("repairable");

    await service.retry(job.id);

    const repaired = repo.get(job.id);
    expect(ytDlpCalls).toBe(1);
    expect(repaired?.status).toBe("completed");
    expect(repaired?.subtitlePath).toBeDefined();
    expect(existsSync(repaired?.subtitlePath ?? "")).toBe(true);
  });

  test("repairs all repairable sidecars without re-downloading videos", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async () => ({
        stream: {
          url: "https://fresh.example/master.m3u8",
          headers: { Referer: "https://fresh.example" },
          timestamp: 0,
          subtitle: "https://fresh.example/subs/en.vtt",
          subtitleList: [{ url: "https://fresh.example/subs/en.vtt", language: "en" }],
        },
        providerId: "vidking",
        selectionChanged: false,
      }),
    });
    let ytDlpCalls = 0;
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] !== "yt-dlp") {
        return { stdout: streamOf(""), stderr: streamOf(""), exited: Promise.resolve(0) } as never;
      }
      ytDlpCalls += 1;
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    let subtitleAttempts = 0;
    globalThis.fetch = mock(async () => {
      subtitleAttempts += 1;
      if (subtitleAttempts <= 2) return new Response("", { status: 503 });
      return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi");
    }) as unknown as typeof fetch;

    const first = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 6, name: "Episode 6" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    const second = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 7, name: "Episode 7" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    await service.processQueue();
    await service.processQueue();

    expect(repo.get(first.id)?.status).toBe("repairable");
    expect(repo.get(second.id)?.status).toBe("repairable");

    const summary = await service.repairRepairableSidecars();

    expect(summary).toEqual({ checked: 2, repaired: 2, stillRepairable: 0, failed: 0 });
    expect(ytDlpCalls).toBe(2);
    expect(repo.get(first.id)?.status).toBe("completed");
    expect(repo.get(second.id)?.status).toBe("completed");
  });

  test("continues repair sweep when one repairable artifact is missing", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      ffmpegAvailable: false,
      downloadPath: tempDir,
      resolveDownloadStream: async () => ({
        stream: {
          url: "https://fresh.example/master.m3u8",
          headers: { Referer: "https://fresh.example" },
          timestamp: 0,
          subtitle: "https://fresh.example/subs/en.vtt",
          subtitleList: [{ url: "https://fresh.example/subs/en.vtt", language: "en" }],
        },
        providerId: "vidking",
        selectionChanged: false,
      }),
    });
    let ytDlpCalls = 0;
    spawnSpy.mockImplementation((command: string[]) => {
      ytDlpCalls += 1;
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });
    let subtitleAttempts = 0;
    globalThis.fetch = mock(async () => {
      subtitleAttempts += 1;
      if (subtitleAttempts <= 2) return new Response("", { status: 503 });
      return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi");
    }) as unknown as typeof fetch;

    const first = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 6, name: "Episode 6" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    const second = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 7, name: "Episode 7" },
      providerId: "vidking",
      mode: "series",
      audioPreference: "original",
      subtitlePreference: "en",
    });
    await service.processQueue();
    await service.processQueue();

    const secondOutput = repo.get(second.id)?.outputPath;
    if (secondOutput) rmSync(secondOutput, { force: true });

    const summary = await service.repairRepairableSidecars();

    expect(summary).toEqual({ checked: 2, repaired: 1, stillRepairable: 0, failed: 1 });
    expect(ytDlpCalls).toBe(2);
    expect(repo.get(first.id)?.status).toBe("completed");
    expect(repo.get(second.id)?.status).toBe("failed");
    expect(repo.get(second.id)?.failureKind).toBe("artifact-missing");
  });

  test("records optional artwork misses without marking the video failed", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      ffmpegAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffmpeg") {
        return {
          stdout: streamOf(""),
          stderr: streamOf("thumbnail failed"),
          exited: Promise.resolve(1),
        } as never;
      }
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf("Duration: 00:00:10.00\n"),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 7, name: "Episode 7" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    await service.processQueue();
    await waitUntil(() => repo.get(job.id)?.status === "completed-with-notes");

    const completed = repo.get(job.id);
    expect(completed?.status).toBe("completed-with-notes");
    expect(completed?.artifactStatus).toBe("optional-missing");
    expect(existsSync(completed?.outputPath ?? "")).toBe(true);
  });

  test("marks zero-byte artifacts invalid instead of completed", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      abortGraceMs: 1,
    });
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
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
      ytDlpAvailable: true,
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

  test("uses media-server friendly output hierarchy", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });

    const episodeJob = await service.enqueue({
      title: { id: "tmdb:1396", type: "series", name: "Breaking Bad", year: "2008" },
      episode: { season: 4, episode: 12, name: "End Times" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    const movieJob = await service.enqueue({
      title: { id: "tmdb:438631", type: "movie", name: "Dune", year: "2021-09-15" },
      stream: { url: "https://example.com/movie.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });

    expect(episodeJob.outputPath).toBe(
      join(tempDir, "Breaking Bad (2008)", "Season 04", "Breaking Bad - S04E12.mp4"),
    );
    expect(movieJob.outputPath).toBe(join(tempDir, "Dune (2021)", "Dune (2021).mp4"));
  });

  test("schedules retry for transient failures", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
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
      ytDlpAvailable: true,
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
      ytDlpAvailable: true,
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
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    spawnSpy.mockImplementation(
      () =>
        ({
          stdout: streamOf(""),
          stderr: streamOf("yt-dlp: invalid argument\n"),
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
    expect(reloaded?.failureKind).toBe("ytdlp-config");
    expect(reloaded?.retryCount).toBe(1);
  });
});

function buildService({
  repo,
  downloadsEnabled,
  ytDlpAvailable,
  downloadPath,
  resolveDownloadStream,
  abortGraceMs,
  ffmpegAvailable = false,
  ffprobeAvailable = false,
  diagnostics,
  configService,
}: {
  repo: DownloadJobsRepository;
  downloadsEnabled: boolean;
  ytDlpAvailable: boolean;
  downloadPath: string;
  resolveDownloadStream?: ConstructorParameters<typeof DownloadService>[0]["resolveDownloadStream"];
  abortGraceMs?: number;
  ffmpegAvailable?: boolean;
  ffprobeAvailable?: boolean;
  diagnostics?: ConstructorParameters<typeof DownloadService>[0]["diagnostics"];
  configService?: ConfigService;
}): DownloadService {
  const defaultConfig = {
    downloadsEnabled,
    downloadPath,
  } as ConfigService;
  return new DownloadService({
    repo,
    config: configService ?? defaultConfig,
    ytDlpAvailable,
    ffprobeAvailable,
    ffmpegAvailable,
    diagnostics,
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

async function waitUntil(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
}
