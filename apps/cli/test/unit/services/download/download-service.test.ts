import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadEnqueueRejectedError, DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

import { waitUntil as sharedWaitUntil } from "../../../support/wait-until";

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

describe("DownloadService", () => {
  let tempDir: string;
  let db: ReturnType<typeof openKunaiDatabase>;
  let repo: DownloadJobsRepository;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-download-service-"));
    db = openKunaiDatabase(join(tempDir, "data.sqlite"));
    runMigrations(db, "data");
    repo = new DownloadJobsRepository(db);
    spawnSpy = spyOn(Bun, "spawn");
    whichSpy = spyOn(Bun, "which");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    // Close before removing: Windows refuses to delete a file that still has an
    // open handle, and SQLite in WAL mode keeps `-shm` mapped until close().
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  /**
   * The output path is product identity: repair, resume and library scanning
   * all look a download up by the exact path that produced it. It therefore
   * has to come from the same canonical position the UI shows, not from a
   * second guess about what "movie" means.
   */
  describe("output naming derives from canonical media position", () => {
    test("an anime job is named episode-only, with no season folder", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: { id: "tmdb:1", type: "series", name: "Frieren" },
        episode: { season: 1, episode: 3, name: "Episode 3" },
        providerId: "allanime",
        mode: "anime",
      });

      expect(repo.get(job.id)?.mediaKind).toBe("anime");
      expect(repo.get(job.id)?.outputPath).toBe(join(tempDir, "Frieren", "Frieren - E03.mp4"));
    });

    test("a series job keeps the season folder and SxxEyy stem", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: { id: "tmdb:2", type: "series", name: "Severance" },
        episode: { season: 1, episode: 3, name: "Episode 3" },
        providerId: "vidking",
        mode: "series",
      });

      expect(repo.get(job.id)?.mediaKind).toBe("series");
      expect(repo.get(job.id)?.outputPath).toBe(
        join(tempDir, "Severance", "Season 01", "Severance - S01E03.mp4"),
      );
    });

    test("a new movie job persists no season and no episode", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: { id: "tmdb:693134", type: "movie", name: "Dune Part Two" },
        providerId: "vidking",
        mode: "series",
      });

      const record = repo.get(job.id);
      expect(record?.mediaKind).toBe("movie");
      expect(record?.season).toBeUndefined();
      expect(record?.episode).toBeUndefined();
    });

    test("an anime film preserves anime identity with movie structure", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: {
          id: "anilist:181053",
          type: "movie",
          name: "Infinity Castle",
          isAnime: true,
          externalIds: { anilistId: "181053" },
        },
        providerId: "allanime",
        mode: "anime",
      });

      const record = repo.get(job.id);
      expect(record?.mediaKind).toBe("anime");
      expect(record?.contentType).toBe("movie");
      expect(record?.season).toBeUndefined();
      expect(record?.episode).toBeUndefined();
      expect(record?.outputPath).not.toContain("S01E01");
    });

    test("enqueue persists the title's external ids and registers them as aliases", async () => {
      // Both halves of the identity contract. The row keeps the ids so nothing
      // has to guess them back out of the title id later, and the alias index
      // learns the title even though it was never watched online — which is
      // what lets a playback read find these assets under any id form.
      const registered: Array<{
        titleId: string;
        aliases: readonly { ns: string; id: string }[];
      }> = [];
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
        titleAliases: {
          upsertAliases(titleId, aliases) {
            registered.push({ titleId, aliases });
          },
        },
      });

      const job = await service.enqueue({
        title: {
          id: "1339713",
          type: "movie",
          name: "Obsession",
          externalIds: { tmdbId: "1339713" },
        },
        providerId: "videasy",
        mode: "series",
      });

      expect(repo.get(job.id)?.externalIds).toEqual({ tmdbId: "1339713" });
      expect(registered).toEqual([
        { titleId: "tmdb:1339713", aliases: [{ ns: "tmdb", id: "1339713" }] },
      ]);
    });

    test("a new video job persists no season and no episode", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: { id: "yt:1", type: "series", name: "Kunai Release Trailer" },
        providerId: "youtube",
        mode: "youtube",
      });

      const record = repo.get(job.id);
      expect(record?.mediaKind).toBe("video");
      expect(record?.season).toBeUndefined();
      expect(record?.episode).toBeUndefined();
    });

    test("a movie job is named title-level", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: { id: "tmdb:3", type: "movie", name: "Dune Part Two" },
        providerId: "vidking",
        mode: "series",
      });

      const record = repo.get(job.id);
      expect(record?.mediaKind).toBe("movie");
      expect(record?.outputPath).toBe(join(tempDir, "Dune Part Two", "Dune Part Two.mp4"));
      expect(record?.outputPath).not.toContain("S01E01");
    });

    test("a youtube job is named title-level as a video", async () => {
      const service = buildService({
        repo,
        downloadsEnabled: true,
        ytDlpAvailable: true,
        downloadPath: tempDir,
      });

      const job = await service.enqueue({
        title: { id: "yt:1", type: "series", name: "Kunai Release Trailer" },
        providerId: "youtube",
        mode: "youtube",
      });

      const record = repo.get(job.id);
      expect(record?.mediaKind).toBe("video");
      expect(record?.outputPath).toBe(
        join(tempDir, "Kunai Release Trailer", "Kunai Release Trailer.mp4"),
      );
    });
  });

  test("rejects a stream URL that begins with a dash without spawning yt-dlp", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "--exec=touch /tmp/pwned", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    await service.processQueue();

    expect(
      spawnSpy.mock.calls.some(
        (call: readonly unknown[]) =>
          Array.isArray(call[0]) && (call[0] as readonly string[])[0] === "yt-dlp",
      ),
    ).toBe(false);
    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.errorMessage).toContain("Refusing to download unsafe stream URL");
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

  test("maps concurrent durable admission conflicts to one duplicate-intent result", async () => {
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

    const results = await Promise.allSettled([service.enqueue(input), service.enqueue(input)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "duplicate-intent" },
    });
    expect(repo.listQueued(10)).toHaveLength(1);
  });

  test("maps retry admission conflicts without exposing a SQLite constraint", async () => {
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
    const failed = await service.enqueue(input);
    repo.fail(failed.id, "terminal", false, new Date().toISOString(), "terminal");
    await service.enqueue(input);

    await expect(service.retry(failed.id)).rejects.toMatchObject({ code: "duplicate-intent" });
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
        // SAFETY: Bun.spawn is intercepted; this fixture implements every process member the service reads.
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

  test("bounds ffprobe and releases queue ownership after forced termination", async () => {
    const waits: number[] = [];
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      ffprobeAvailable: true,
      downloadPath: tempDir,
      ffprobeDeadline: (milliseconds) => {
        waits.push(milliseconds);
        return { expired: Promise.resolve(), cancel() {} };
      },
    });
    whichSpy.mockImplementation((name: string) => (name === "ffprobe" ? "/usr/bin/ffprobe" : null));

    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const probe = createHangingProbe("SIGKILL");
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffprobe") {
        markProbeStarted();
        return probe.process;
      }
      const outputIndex = command.indexOf("-o");
      const outputPath = outputIndex >= 0 ? command[outputIndex + 1] : undefined;
      if (outputPath) writeFileSync(outputPath, "video-bytes");
      // SAFETY: Bun.spawn is intercepted; this fixture implements every process member the service reads.
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Deadline" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://secret.example/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    const processing = service.processQueue();
    await probeStarted;
    await processing;

    const reloaded = repo.get(job.id);
    expect(waits).toEqual([30_000, 2_500, 2_500, 250]);
    expect(probe.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(probe.stdoutCancelled).toBe(true);
    expect(repo.listRunning(10)).toEqual([]);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureKind).toBe("artifact-timeout");
    expect(reloaded?.errorMessage).toBe(
      "artifact-validation-timeout: ffprobe exceeded 30000ms deadline",
    );
    expect(reloaded?.errorMessage).not.toContain(job.tempPath);
    expect(reloaded?.errorMessage).not.toContain("secret.example");
  });

  test("cancels ffprobe stdout so abort can release the running lease", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      ffprobeAvailable: true,
      downloadPath: tempDir,
      ffprobeDeadline: () => ({
        expired: new Promise<never>(() => {}),
        cancel() {},
      }),
    });
    whichSpy.mockImplementation((name: string) => (name === "ffprobe" ? "/usr/bin/ffprobe" : null));

    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const probe = createHangingProbe("SIGTERM");
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffprobe") {
        markProbeStarted();
        return probe.process;
      }
      const outputIndex = command.indexOf("-o");
      const outputPath = outputIndex >= 0 ? command[outputIndex + 1] : undefined;
      if (outputPath) writeFileSync(outputPath, "video-bytes");
      // SAFETY: Bun.spawn is intercepted; this fixture implements every process member the service reads.
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:2", type: "series", name: "Cancelled Probe" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    const processing = service.processQueue();
    await probeStarted;

    await service.abort(job.id);
    await processing;

    expect(probe.stdoutCancelled).toBe(true);
    expect(probe.killSignals).toEqual(["SIGTERM"]);
    expect(repo.listRunning(10)).toEqual([]);
    expect(repo.get(job.id)?.status).toBe("aborted");
  });

  test("terminates ffprobe immediately when abort wins before process registration", async () => {
    const waits: number[] = [];
    let service!: DownloadService;
    let aborting: Promise<void> | undefined;
    service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      ffprobeAvailable: true,
      downloadPath: tempDir,
      ffprobeDeadline: (milliseconds) => {
        waits.push(milliseconds);
        return { expired: Promise.resolve(), cancel() {} };
      },
    });
    whichSpy.mockImplementation((name: string) => (name === "ffprobe" ? "/usr/bin/ffprobe" : null));

    let releaseStdoutCancel!: () => void;
    const stdoutCancel = new Promise<void>((resolve) => {
      releaseStdoutCancel = resolve;
    });
    const probe = createHangingProbe("SIGKILL", { stdoutCancel });
    let jobId = "";
    spawnSpy.mockImplementation((command: string[]) => {
      if (command[0] === "ffprobe") {
        aborting = service.abort(jobId);
        return probe.process;
      }
      const outputIndex = command.indexOf("-o");
      const outputPath = outputIndex >= 0 ? command[outputIndex + 1] : undefined;
      if (outputPath) writeFileSync(outputPath, "video-bytes");
      // SAFETY: Bun.spawn is intercepted; this fixture implements every process member the service reads.
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
        kill() {},
      } as never;
    });

    const job = await service.enqueue({
      title: { id: "tmdb:3", type: "series", name: "Pre-registration Abort" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    jobId = job.id;

    const processing = service.processQueue();
    await probe.stdoutCancelStarted;
    const killedBeforeStdoutSettled = probe.killSignals.length > 0;
    releaseStdoutCancel();
    await processing;
    await aborting;

    expect(killedBeforeStdoutSettled).toBe(true);
    expect(waits).not.toContain(30_000);
    expect(probe.stdoutCancelled).toBe(true);
    expect(probe.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(repo.get(job.id)?.status).toBe("aborted");
  });

  test("carries poster metadata and caches poster artwork without ffmpeg", async () => {
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
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
      } as never;
    });
    globalThis.fetch = mock(
      async () =>
        new Response("poster-bytes", {
          headers: { "content-type": "image/jpeg" },
        }),
    ) as unknown as typeof fetch;

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
    expect(
      spawnSpy.mock.calls.some(
        (call: readonly unknown[]) =>
          Array.isArray(call[0]) && (call[0] as readonly string[])[0] === "ffmpeg",
      ),
    ).toBe(false);
  });

  test("stores durable intent and resolves a fresh stream before processing", async () => {
    const resolvedUrls: string[] = [];
    let resolvedTitleExternalIds: unknown;
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      resolveDownloadStream: async (intent) => {
        resolvedUrls.push(`${intent.providerId}:${intent.title.id}:${intent.episode?.episode}`);
        resolvedTitleExternalIds = intent.title.externalIds;
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
    expect(resolvedTitleExternalIds).toEqual({ tmdbId: "1" });
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
    globalThis.fetch = mock(
      async () => new Response("not an image", { headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;

    const job = await service.enqueue({
      title: {
        id: "tmdb:1",
        type: "series",
        name: "Example",
        posterUrl: "https://img.example/poster.jpg",
      },
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
    writeFileSync(job.outputPath, "last-known-good");
    await service.processQueue();

    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.failureKind).toBe("artifact-invalid");
    expect(reloaded?.artifactStatus).toBe("invalid-file");
    expect(await Bun.file(job.outputPath).text()).toBe("last-known-good");
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
    await waitUntil(() => repo.get(job.id)?.status === "running");
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
    await waitUntil(() => repo.get(job.id)?.status === "running");
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

  test("adopts a valid output published before a crash instead of downloading it again", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await enqueueService.enqueue({
      title: { id: "tmdb:1", type: "movie", name: "Crash Window" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
    });
    expect(repo.markRunning(job.id, "2026-04-29T00:01:00.000Z")).toBe(true);
    writeFileSync(job.outputPath, "valid-media-bytes");
    writeFileSync(job.tempPath, "orphaned-temp-bytes");

    const recoveryService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      downloadPath: tempDir,
    });
    await recoveryService.processQueue();

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(repo.get(job.id)?.status).toBe("completed");
    expect(repo.get(job.id)?.fileSize).toBe("valid-media-bytes".length);
    expect(existsSync(job.outputPath)).toBe(true);
    expect(existsSync(job.tempPath)).toBe(false);
  });

  test("removes an invalid published output before retrying an interrupted job", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await enqueueService.enqueue({
      title: { id: "tmdb:2", type: "movie", name: "Empty Crash Window" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
    });
    expect(repo.markRunning(job.id, "2026-04-29T00:01:00.000Z")).toBe(true);
    writeFileSync(job.outputPath, "");
    writeFileSync(job.tempPath, "orphaned-temp-bytes");

    const recoveryService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      downloadPath: tempDir,
    });
    await recoveryService.processQueue();

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(repo.get(job.id)?.status).toBe("queued");
    expect(repo.get(job.id)?.errorMessage).toBe(
      "download interrupted after publishing an invalid artifact",
    );
    expect(existsSync(job.outputPath)).toBe(false);
    expect(existsSync(job.tempPath)).toBe(false);
  });

  test("preserves a valid published output when recovery persistence fails", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await enqueueService.enqueue({
      title: { id: "tmdb:6", type: "movie", name: "Commit Failure" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
    });
    expect(repo.markRunning(job.id, "2026-04-29T00:01:00.000Z")).toBe(true);
    writeFileSync(job.outputPath, "valid-media-that-must-survive");
    const updateFileSizeSpy = spyOn(repo, "updateFileSize").mockImplementation(() => {
      throw new Error("simulated SQLite write failure");
    });

    const recoveryService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      downloadPath: tempDir,
    });
    await expect(recoveryService.processQueue()).rejects.toThrow("simulated SQLite write failure");

    expect(existsSync(job.outputPath)).toBe(true);
    expect(await Bun.file(job.outputPath).text()).toBe("valid-media-that-must-survive");
    updateFileSizeSpy.mockRestore();
  });

  test("preserves a published artifact when recovery ffprobe reaches its deadline", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await enqueueService.enqueue({
      title: { id: "tmdb:7", type: "movie", name: "Probe Timeout" },
      stream: { url: "https://secret.example/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
    });
    expect(repo.markRunning(job.id, "2026-04-29T00:01:00.000Z")).toBe(true);
    writeFileSync(job.outputPath, "published-media-that-must-survive");

    const probe = createHangingProbe("SIGKILL");
    whichSpy.mockImplementation((name: string) => (name === "ffprobe" ? "/usr/bin/ffprobe" : null));
    spawnSpy.mockImplementation(() => probe.process);
    const recoveryService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      ffprobeAvailable: true,
      downloadPath: tempDir,
      ffprobeDeadline: () => ({ expired: Promise.resolve(), cancel() {} }),
    });

    await recoveryService.processQueue();

    const recovered = repo.get(job.id);
    expect(probe.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(existsSync(job.outputPath)).toBe(true);
    expect(await Bun.file(job.outputPath).text()).toBe("published-media-that-must-survive");
    expect(recovered?.status).toBe("failed");
    expect(recovered?.failureKind).toBe("artifact-timeout");
    expect(recovered?.errorMessage).toBe(
      "artifact-validation-timeout: ffprobe exceeded 30000ms deadline",
    );
    expect(recovered?.errorMessage).not.toContain(job.outputPath);
    expect(recovered?.errorMessage).not.toContain("secret.example");
  });

  test("shutdown owns a recovery ffprobe and preserves its published artifact", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await enqueueService.enqueue({
      title: { id: "tmdb:8", type: "movie", name: "Recovery Shutdown" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
    });
    expect(repo.markRunning(job.id, "2026-04-29T00:01:00.000Z")).toBe(true);
    writeFileSync(job.outputPath, "published-media-that-must-survive-shutdown");

    let expireProbe!: () => void;
    let deadlineCount = 0;
    const probeDeadline = new Promise<void>((resolve) => {
      expireProbe = resolve;
    });
    const probe = createHangingProbe("SIGTERM");
    whichSpy.mockImplementation((name: string) => (name === "ffprobe" ? "/usr/bin/ffprobe" : null));
    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    spawnSpy.mockImplementation(() => {
      markProbeStarted();
      return probe.process;
    });
    const recoveryService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      ffprobeAvailable: true,
      downloadPath: tempDir,
      ffprobeDeadline: () => {
        deadlineCount += 1;
        return {
          expired: deadlineCount === 1 ? probeDeadline : Promise.resolve(),
          cancel() {},
        };
      },
    });

    const processing = recoveryService.processQueue();
    await probeStarted;
    await recoveryService.pauseActiveJobsForShutdown("download paused by recovery shutdown");
    const killedBeforeDeadline = probe.killSignals.length > 0;
    expireProbe();
    await processing;

    const recovered = repo.get(job.id);
    expect(killedBeforeDeadline).toBe(true);
    expect(probe.stdoutCancelled).toBe(true);
    expect(probe.killSignals).toEqual(["SIGTERM"]);
    expect(existsSync(job.outputPath)).toBe(true);
    expect(await Bun.file(job.outputPath).text()).toBe(
      "published-media-that-must-survive-shutdown",
    );
    expect(recovered?.status).toBe("queued");
    expect(recovered?.failureKind).toBe("interrupted");
    expect(recovered?.errorMessage).toBe("download paused by recovery shutdown");
  });

  test("does not recover a freshly heartbeating job owned by another process", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await enqueueService.enqueue({
      title: { id: "tmdb:3", type: "movie", name: "Active Elsewhere" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
    });
    const activeAt = new Date().toISOString();
    expect(repo.markRunning(job.id, activeAt)).toBe(true);
    writeFileSync(job.outputPath, "partially-published-by-owner");
    writeFileSync(job.tempPath, "active-temp-bytes");

    const observingService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      downloadPath: tempDir,
    });
    await observingService.processQueue();

    expect(repo.get(job.id)?.status).toBe("running");
    expect(existsSync(job.outputPath)).toBe(true);
    expect(existsSync(job.tempPath)).toBe(true);
  });

  test("recovering a stale job does not delete a fresh owner's temp file in the same directory", async () => {
    const enqueueService = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const stale = await enqueueService.enqueue({
      title: { id: "tmdb:4", type: "series", name: "Shared Directory" },
      episode: { season: 1, episode: 1, name: "Stale Owner" },
      stream: { url: "https://example.com/stale.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
      outputDirectory: tempDir,
    });
    const fresh = await enqueueService.enqueue({
      title: { id: "tmdb:4", type: "series", name: "Shared Directory" },
      episode: { season: 1, episode: 2, name: "Fresh Owner" },
      stream: { url: "https://example.com/fresh.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
      mode: "series",
      outputDirectory: tempDir,
    });
    expect(repo.markRunning(stale.id, "2026-04-29T00:01:00.000Z")).toBe(true);
    expect(repo.markRunning(fresh.id, new Date().toISOString())).toBe(true);
    writeFileSync(stale.outputPath, "valid-stale-output");
    writeFileSync(stale.tempPath, "stale-temp");
    writeFileSync(fresh.tempPath, "fresh-temp");

    const recoveryService = buildService({
      repo,
      downloadsEnabled: false,
      ytDlpAvailable: false,
      downloadPath: tempDir,
    });
    await recoveryService.processQueue();

    expect(repo.get(stale.id)?.status).toBe("completed");
    expect(repo.get(fresh.id)?.status).toBe("running");
    expect(existsSync(stale.tempPath)).toBe(false);
    expect(existsSync(fresh.tempPath)).toBe(true);
  });

  test("beginShutdown closes work admission before any queue snapshot", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
    });
    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });

    service.beginShutdown("download paused by shutdown");
    await service.processQueue();

    // The queued job must not be claimed after shutdown began.
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(repo.get(job.id)?.status).toBe("queued");
  });

  test("pauseActiveJobsForShutdown honors explicit shutdown wait budgets", async () => {
    const service = buildService({
      repo,
      downloadsEnabled: true,
      ytDlpAvailable: true,
      downloadPath: tempDir,
      abortGraceMs: 20,
    });
    let exitProcess!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      exitProcess = resolve;
    });
    spawnSpy.mockImplementation(
      () =>
        ({
          stdout: streamOf(""),
          stderr: streamOf(""),
          exited,
          kill: () => exitProcess(0),
        }) as never,
    );

    const job = await service.enqueue({
      title: { id: "tmdb:1", type: "series", name: "Example" },
      episode: { season: 1, episode: 1, name: "Episode 1" },
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: 0 },
      providerId: "vidking",
    });
    const running = service.processQueue();
    await waitUntil(() => repo.get(job.id)?.status === "running");

    const startedAt = Date.now();
    await service.pauseActiveJobsForShutdown("download paused by shutdown", {
      gracefulWaitMs: 50,
      forceWaitMs: 50,
      inactiveWaitMs: 50,
    });
    await running;

    // Budgeted waits keep the whole pause far below the legacy multi-second path.
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("queued");
    expect(reloaded?.nextRetryAt).toBeDefined();
  });
});

function buildService({
  repo,
  downloadsEnabled,
  ytDlpAvailable,
  downloadPath,
  resolveDownloadStream,
  abortGraceMs,
  ffprobeAvailable = false,
  ffprobeDeadline,
  diagnostics,
  configService,
  titleAliases = { upsertAliases() {} },
}: {
  repo: DownloadJobsRepository;
  downloadsEnabled: boolean;
  ytDlpAvailable: boolean;
  downloadPath: string;
  resolveDownloadStream?: ConstructorParameters<typeof DownloadService>[0]["resolveDownloadStream"];
  abortGraceMs?: number;
  ffprobeAvailable?: boolean;
  ffprobeDeadline?: ConstructorParameters<typeof DownloadService>[0]["ffprobeDeadline"];
  diagnostics?: ConstructorParameters<typeof DownloadService>[0]["diagnostics"];
  configService?: ConfigService;
  titleAliases?: ConstructorParameters<typeof DownloadService>[0]["titleAliases"];
}): DownloadService {
  const defaultConfig = {
    downloadsEnabled,
    downloadPath,
    offlineArtworkCacheEnabled: true,
    offlineFreeSpaceReserveBytes: 0,
    offlineUnknownEpisodeEstimateBytes: 1,
  } as ConfigService;
  return new DownloadService({
    repo,
    titleAliases,
    config: configService ?? defaultConfig,
    ytDlpAvailable,
    ffprobeAvailable,
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
    ffprobeDeadline,
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

function createHangingProbe(
  exitOn: "SIGTERM" | "SIGKILL",
  options: { readonly stdoutCancel?: Promise<void> } = {},
) {
  let resolveExit!: (code: number) => void;
  let markStdoutCancelStarted!: () => void;
  let stdoutCancelled = false;
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const stdoutCancelStarted = new Promise<void>((resolve) => {
    markStdoutCancelStarted = resolve;
  });
  // SAFETY: Bun.spawn is intercepted; this fixture implements stdout, stderr, exited, and kill used here.
  const process = {
    stdout: new ReadableStream<Uint8Array>({
      cancel() {
        stdoutCancelled = true;
        markStdoutCancelStarted();
        return options.stdoutCancel;
      },
    }),
    stderr: streamOf(""),
    exited,
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      if (signal === exitOn) resolveExit(signal === "SIGTERM" ? 143 : 137);
    },
  } as never;
  return {
    process,
    killSignals,
    stdoutCancelStarted,
    get stdoutCancelled() {
      return stdoutCancelled;
    },
  };
}

/** Local signature kept so existing call sites read unchanged. */
async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  await sharedWaitUntil(predicate, { timeoutMs });
}
