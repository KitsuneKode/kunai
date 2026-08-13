import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadService } from "@/services/download/DownloadService";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

const encoder = new TextEncoder();

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

type ResolveInput = {
  readonly title: { readonly type: string; readonly name: string };
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly mode?: string;
};

/**
 * Resolving a stream is allowed to need a synthetic episode slot internally —
 * some provider adapters index everything by season/episode. What it must never
 * do is write that slot back as product identity, because the stored row is
 * what every surface, filename and repair path reads afterwards.
 */
describe("download resolve preserves stored identity", () => {
  let tempDir: string;
  let db: ReturnType<typeof openKunaiDatabase>;
  let repo: DownloadJobsRepository;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-download-resolve-"));
    db = openKunaiDatabase(join(tempDir, "data.sqlite"));
    runMigrations(db, "data");
    repo = new DownloadJobsRepository(db);
    spawnSpy = spyOn(Bun, "spawn");
    whichSpy = spyOn(Bun, "which");
    spawnSpy.mockImplementation((command: string[]) => {
      const oIndex = command.indexOf("-o");
      const outputPath = oIndex >= 0 ? command[oIndex + 1] : command[command.length - 1];
      if (typeof outputPath === "string") writeFileSync(outputPath, "video-bytes");
      return {
        stdout: streamOf("[download] 100% of 1.2GiB\n"),
        stderr: streamOf(""),
        exited: Promise.resolve(0),
      } as never;
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function buildService(seen: ResolveInput[]): DownloadService {
    return new DownloadService({
      repo,
      titleAliases: { upsertAliases() {} },
      config: {
        downloadsEnabled: true,
        downloadPath: tempDir,
        offlineArtworkCacheEnabled: false,
        offlineFreeSpaceReserveBytes: 0,
        offlineUnknownEpisodeEstimateBytes: 1,
        youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
      } as unknown as ConfigService,
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
      resolveDownloadStream: async (input) => {
        seen.push(input as unknown as ResolveInput);
        return {
          stream: { url: "https://example.com/out.m3u8", headers: {}, timestamp: 0 },
          providerId: "vidking",
          selectionChanged: false,
        };
      },
    });
  }

  test("a title-level movie job resolves with no episode and keeps NULL position columns", async () => {
    const seen: ResolveInput[] = [];
    const service = buildService(seen);

    const job = await service.enqueue({
      title: { id: "tmdb:693134", type: "movie", name: "Dune Part Two" },
      providerId: "vidking",
      mode: "series",
    });

    expect(repo.get(job.id)?.season).toBeUndefined();
    expect(repo.get(job.id)?.episode).toBeUndefined();

    await service.processQueue();

    expect(seen[0]?.episode).toBeUndefined();
    expect(seen[0]?.title.type).toBe("movie");
    const after = repo.get(job.id);
    expect(after?.mediaKind).toBe("movie");
    expect(after?.season).toBeUndefined();
    expect(after?.episode).toBeUndefined();
  });

  test("a title-level video job keeps its video identity through resolve", async () => {
    const seen: ResolveInput[] = [];
    const service = buildService(seen);

    const job = await service.enqueue({
      title: { id: "yt:1", type: "series", name: "Kunai Release Trailer" },
      providerId: "youtube",
      mode: "youtube",
    });

    await service.processQueue();

    expect(seen[0]?.episode).toBeUndefined();
    expect(seen[0]?.mode).toBe("youtube");
    const after = repo.get(job.id);
    expect(after?.mediaKind).toBe("video");
    expect(after?.season).toBeUndefined();
    expect(after?.episode).toBeUndefined();
  });

  /**
   * Read compatibility. Rows written before movies became title-level still
   * carry season 1 / episode 1 and must keep working without any migration.
   */
  test("a legacy synthetic movie row still resolves and keeps its stored slot", async () => {
    const seen: ResolveInput[] = [];
    const service = buildService(seen);

    const now = new Date().toISOString();
    repo.enqueue({
      id: "legacy-movie",
      titleId: "tmdb:693134",
      titleName: "Dune Part Two",
      mediaKind: "movie",
      season: 1,
      episode: 1,
      providerId: "vidking",
      streamUrl: "",
      headers: {},
      outputPath: join(tempDir, "Dune Part Two", "Dune Part Two.mp4"),
      tempPath: join(tempDir, "Dune Part Two", "Dune Part Two.mp4.tmp"),
      createdAt: now,
      updatedAt: now,
    });

    await service.processQueue();

    // The resolver may see the legacy slot; the stored row must not be rewritten.
    const after = repo.get("legacy-movie");
    expect(after?.mediaKind).toBe("movie");
    expect(after?.season).toBe(1);
    expect(after?.episode).toBe(1);
  });

  test("a legacy synthetic movie row remains retryable and removable", async () => {
    const service = buildService([]);
    const now = new Date().toISOString();
    repo.enqueue({
      id: "legacy-movie-2",
      titleId: "tmdb:693134",
      titleName: "Dune Part Two",
      mediaKind: "movie",
      season: 1,
      episode: 1,
      providerId: "vidking",
      streamUrl: "https://example.com/legacy.m3u8",
      headers: {},
      outputPath: join(tempDir, "legacy2.mp4"),
      tempPath: join(tempDir, "legacy2.mp4.tmp"),
      createdAt: now,
      updatedAt: now,
    });

    await service.retry("legacy-movie-2");
    expect(repo.get("legacy-movie-2")?.season).toBe(1);

    await service.deleteJob("legacy-movie-2");
    expect(repo.get("legacy-movie-2")).toBeUndefined();
  });
});
