import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadService, type DownloadResolveResult } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import * as youtubeProviders from "@kunai/providers/youtube";
import { configureYoutubeProvider, type RunYtDlpProcessOptions } from "@kunai/providers/youtube";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

describe("DownloadService youtube argv contract", () => {
  let tempDir: string;
  let repo: DownloadJobsRepository;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;
  let runYtDlpSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-youtube-download-"));
    const db = openKunaiDatabase(join(tempDir, "data.sqlite"));
    runMigrations(db, "data");
    repo = new DownloadJobsRepository(db);
    spawnSpy = spyOn(Bun, "spawn");
    whichSpy = spyOn(Bun, "which");
    configureYoutubeProvider({
      cookiesFromBrowser: "firefox",
      cookiesFile: "/tmp/cookies.txt",
      extractorArgs: "youtube:player_client=android",
      sponsorblockRemove: "sponsor",
    });
    runYtDlpSpy = spyOn(youtubeProviders, "runYtDlpProcess");
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    runYtDlpSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    configureYoutubeProvider({});
  });

  test("passes 1080p merge mp4 and cookie argv through runYtDlpProcess", async () => {
    let capturedArgs: readonly string[] = [];
    runYtDlpSpy.mockImplementation((options: RunYtDlpProcessOptions) => {
      capturedArgs = options.args;
      const oIndex = options.args.indexOf("-o");
      const outputPath = oIndex >= 0 ? options.args[oIndex + 1] : "";
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        process: { kill: mock(() => {}) } as never,
        completed: Promise.resolve({ exitCode: 0, stderr: "" }),
        cancel: mock(() => {}),
      };
    });

    const service = buildYoutubeService({
      repo,
      downloadPath: tempDir,
      resolveDownloadStream: async () => youtubeResolveResult() as unknown as DownloadResolveResult,
    });

    const job = await service.enqueue({
      title: { id: "youtube:video:abc123", type: "movie", name: "Example video" },
      stream: {
        url: "https://www.youtube.com/watch?v=abc123",
        headers: {},
        timestamp: 0,
      },
      providerId: "youtube",
      mode: "youtube",
      selectedQualityLabel: "1080p",
    });
    await service.processQueue();

    expect(repo.get(job.id)?.status).toBe("completed");
    expect(capturedArgs.join(" ")).toContain("bestvideo[height<=1080]");
    expect(capturedArgs).toEqual(
      expect.arrayContaining([
        "--merge-output-format",
        "mp4",
        "--write-subs",
        "--write-auto-subs",
        "--cookies-from-browser",
        "firefox",
        "--cookies",
        "/tmp/cookies.txt",
      ]),
    );
    expect(runYtDlpSpy).toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("rejects live youtube streams before yt-dlp spawn", async () => {
    runYtDlpSpy.mockImplementation(() => {
      throw new Error("runYtDlpProcess should not run for live streams");
    });

    const service = buildYoutubeService({
      repo,
      downloadPath: tempDir,
      resolveDownloadStream: async () =>
        youtubeResolveResult({
          isLive: true,
          liveStatus: "live",
        }) as unknown as DownloadResolveResult,
    });

    const job = await service.enqueue({
      title: { id: "youtube:video:live123", type: "movie", name: "Live stream" },
      stream: {
        url: "https://www.youtube.com/watch?v=live123",
        headers: {},
        timestamp: 0,
      },
      providerId: "youtube",
      mode: "youtube",
    });
    await service.processQueue();

    const reloaded = repo.get(job.id);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.errorMessage).toContain("Live YouTube streams cannot be downloaded");
    expect(runYtDlpSpy).not.toHaveBeenCalled();
  });

  test("abort calls runYtDlpProcess cancel handle", async () => {
    const cancel = mock(() => {});
    let resolveCompleted!: (value: { exitCode: number; stderr: string }) => void;
    const completed = new Promise<{ exitCode: number; stderr: string }>((resolve) => {
      resolveCompleted = resolve;
    });
    runYtDlpSpy.mockImplementation(() => ({
      process: { kill: mock(() => {}) } as never,
      completed,
      cancel,
    }));

    const service = buildYoutubeService({
      repo,
      downloadPath: tempDir,
      resolveDownloadStream: async () => youtubeResolveResult() as unknown as DownloadResolveResult,
      abortGraceMs: 0,
    });

    const job = await service.enqueue({
      title: { id: "youtube:video:abc123", type: "movie", name: "Example video" },
      stream: {
        url: "https://www.youtube.com/watch?v=abc123",
        headers: {},
        timestamp: 0,
      },
      providerId: "youtube",
      mode: "youtube",
    });
    const processPromise = service.processQueue();
    await Bun.sleep(20);
    await service.abort(job.id);
    resolveCompleted({ exitCode: 1, stderr: "terminated" });
    await processPromise;

    expect(cancel).toHaveBeenCalled();
  });
});

function youtubeResolveResult(
  metadata: { readonly isLive?: boolean; readonly liveStatus?: string } = {},
) {
  return {
    stream: {
      url: "https://www.youtube.com/watch?v=abc123",
      headers: {},
      timestamp: Date.now(),
      providerResolveResult: {
        selectedStreamId: "stream:youtube:abc123:1080p",
        streams: [
          {
            id: "stream:youtube:abc123:1080p",
            qualityLabel: "1080p",
            qualityRank: 1080,
            metadata,
          },
        ],
      },
    },
    providerId: "youtube",
    selectionChanged: false,
  } as const;
}

function buildYoutubeService({
  repo,
  downloadPath,
  resolveDownloadStream,
  abortGraceMs,
}: {
  repo: DownloadJobsRepository;
  downloadPath: string;
  resolveDownloadStream: ConstructorParameters<typeof DownloadService>[0]["resolveDownloadStream"];
  abortGraceMs?: number;
}): DownloadService {
  const config = {
    downloadsEnabled: true,
    downloadPath,
    offlineArtworkCacheEnabled: false,
    offlineFreeSpaceReserveBytes: 0,
    offlineUnknownEpisodeEstimateBytes: 1,
    youtubeMetadata: {
      cookiesFromBrowser: "firefox",
      cookiesFile: "/tmp/cookies.txt",
      extractorArgs: "youtube:player_client=android",
      sponsorblockRemove: "sponsor",
      instanceUrl: "",
      pipedApiUrl: "",
    },
    youtubeLanguageProfile: {
      quality: "1080p",
      audio: "original",
      subtitle: "en",
    },
  } as ConfigService;

  return new DownloadService({
    repo,
    config,
    ytDlpAvailable: true,
    ffprobeAvailable: false,
    resolveDownloadStream,
    abortGraceMs,
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
