import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatOfflineJobListingTitle,
  formatOfflineLibraryGroupDetail,
  formatOfflineLibraryGroupLabel,
  formatOfflineMediaDuration,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  groupOfflineLibraryEntries,
  formatOfflineSecondaryLine,
  offlineStatusIcon,
  resolveOfflineJobPreviewImage,
  resolveOfflineArtifactStatus,
} from "@/services/offline/offline-library";
import {
  dataMigrations,
  DownloadJobsRepository,
  openKunaiDatabase,
  runMigrations,
  type DownloadJobRecord,
} from "@kunai/storage";

function minimalJob(
  patch: Partial<DownloadJobRecord> & Pick<DownloadJobRecord, "id">,
): DownloadJobRecord {
  return {
    titleId: "t",
    titleName: "Demo",
    mediaKind: "series",
    providerId: "p",
    streamUrl: "https://x",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/downloads/demo-s01e01.mp4",
    tempPath: "/downloads/demo.tmp",
    retryCount: 0,
    attempt: 1,
    maxAttempts: 3,
    createdAt: "a",
    updatedAt: "b",
    completedAt: "c",
    ...patch,
  };
}

describe("offline-library helpers", () => {
  test("formatOfflineJobListingTitle mirrors download panel wording", () => {
    expect(
      formatOfflineJobListingTitle(
        minimalJob({
          id: "1",
          titleName: "Example",
          season: 2,
          episode: 8,
          outputPath: "/o.mp4",
        }),
      ),
    ).toBe("Example  ·  S02E08");
  });

  test("formatOfflineJobListingTitle presents a legacy synthetic movie row as Movie", () => {
    const listing = formatOfflineJobListingTitle(
      minimalJob({
        id: "1",
        titleName: "Dune: Part Two",
        mediaKind: "movie",
        season: 1,
        episode: 1,
        outputPath: "/o.mp4",
      }),
    );
    expect(listing).toBe("Dune: Part Two  ·  Movie");
    expect(listing).not.toContain("S01E01");
  });

  test("formatOfflineJobListingTitle uses episode-only labels for anime", () => {
    expect(
      formatOfflineJobListingTitle(
        minimalJob({
          id: "1",
          titleName: "Frieren",
          mediaKind: "anime",
          season: 1,
          episode: 3,
          outputPath: "/o.mp4",
        }),
      ),
    ).toBe("Frieren  ·  E03");
  });

  test("an anime film library group never exposes a legacy episode slot", () => {
    const groups = groupOfflineLibraryEntries([
      {
        job: minimalJob({
          id: "1",
          titleId: "anilist:181053",
          titleName: "Infinity Castle",
          mediaKind: "anime",
          contentType: "movie",
          season: 1,
          episode: 1,
          outputPath: "/downloads/infinity-castle.mp4",
        }),
        status: "ready",
      },
    ]);

    expect(formatOfflineLibraryGroupLabel(groups[0]!)).toBe("Infinity Castle  ·  1 movie");
    expect(formatOfflineLibraryGroupDetail(groups[0]!)).not.toContain("E01");
  });

  test("formatOfflineJobListingTitle keeps video title-level", () => {
    expect(
      formatOfflineJobListingTitle(
        minimalJob({
          id: "1",
          titleName: "Kunai Release Trailer",
          mediaKind: "video",
          season: 1,
          episode: 1,
          outputPath: "/o.mp4",
        }),
      ),
    ).toBe("Kunai Release Trailer  ·  Video");
  });

  test("offlineStatusIcon matches artifact health", () => {
    expect(offlineStatusIcon("ready")).toBe("✓");
    expect(offlineStatusIcon("missing")).toBe("!");
  });

  test("secondary line includes subtitles hint", () => {
    expect(
      formatOfflineSecondaryLine(
        minimalJob({ id: "1", subtitlePath: "/downloads/x.srt", outputPath: "/downloads/x.mp4" }),
        "ready",
      ),
    ).toContain("subtitles cached");
  });

  test("secondary line distinguishes completed videos with sidecar notes", () => {
    expect(
      formatOfflineSecondaryLine(
        minimalJob({
          id: "1",
          status: "completed-with-notes",
          artifactStatus: "optional-missing",
          outputPath: "/downloads/x.mp4",
        }),
        "ready",
      ),
    ).toContain("video ready, optional artwork missing");
  });

  test("offline shelf copy surfaces readiness before filesystem noise", () => {
    const job = minimalJob({
      id: "1",
      titleName: "Example",
      season: 1,
      episode: 4,
      fileSize: 15_728_640,
      durationMs: 1_500_000,
      subtitlePath: "/downloads/example.srt",
      introSkipJson: JSON.stringify({ openings: [] }),
      posterUrl: "https://img.example/poster.jpg",
      thumbnailPath: "/downloads/example.thumbnail.jpg",
      outputPath: "/downloads/Example/episode-4.mp4",
    });

    expect(formatOfflineShelfBadge(job, "ready")).toBe("offline ready");
    expect(formatOfflineShelfDetail(job, "ready")).toBe(
      "S01E04 · 25m · 15.0 MB · subtitles cached · timing cached · thumbnail ready · Example",
    );
    expect(formatOfflineShelfBadge(job, "missing")).toBe("file missing");
  });

  test("offline duration labels stay compact for picker rows", () => {
    expect(formatOfflineMediaDuration(1_500_000)).toBe("25m");
    expect(formatOfflineMediaDuration(3_720_000)).toBe("1h 02m");
    expect(formatOfflineMediaDuration(undefined)).toBeNull();
  });

  test("offline library groups completed files by title before showing episodes", () => {
    const groups = groupOfflineLibraryEntries(
      [
        {
          job: minimalJob({
            id: "bb-1",
            titleId: "bb",
            titleName: "Breaking Bad",
            season: 5,
            episode: 1,
            fileSize: 100,
            introSkipJson: JSON.stringify({ openings: [] }),
            posterUrl: "https://img.example/bb.jpg",
            completedAt: "2026-05-12T00:00:00.000Z",
          }),
          status: "ready",
        },
        {
          job: minimalJob({
            id: "bb-2",
            titleId: "bb",
            titleName: "Breaking Bad",
            season: 5,
            episode: 2,
            completedAt: "2026-05-13T00:00:00.000Z",
          }),
          status: "missing",
        },
        {
          job: minimalJob({
            id: "solo-1",
            titleId: "solo",
            titleName: "Solo Leveling",
            season: 1,
            episode: 1,
            completedAt: "2026-05-14T00:00:00.000Z",
          }),
          status: "ready",
        },
      ],
      { allowRemoteArtwork: true },
    );

    expect(groups.map((group) => group.titleName)).toEqual(["Solo Leveling", "Breaking Bad"]);
    expect(formatOfflineLibraryGroupLabel(groups[1]!)).toBe("Breaking Bad  ·  2 episodes");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("1 ready");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("1 needs attention");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("artwork ready");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("timing cached");
    expect(groups[1]!.previewImageUrl).toBe("https://img.example/bb.jpg");
    expect(groups[1]!.entries.map((entry) => entry.job.episode)).toEqual([1, 2]);
  });

  test("legacy null structure and new series jobs for one title remain one offline group", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-offline-legacy-content-type-"));
    const db = openKunaiDatabase(join(dir, "data.sqlite"), { wal: false });
    try {
      runMigrations(
        db,
        "data",
        dataMigrations.filter((migration) => migration.id !== "028_data_download_job_content_type"),
      );
      db.query(
        `INSERT INTO download_jobs (
          id, title_id, title_name, media_kind, season, episode, provider_id,
          stream_url, headers_json, status, progress_percent, output_path, temp_path,
          retry_count, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "legacy-1",
        "anilist:1",
        "Frieren",
        "anime",
        1,
        1,
        "allanime",
        "https://example.invalid/legacy.m3u8",
        "{}",
        "completed",
        100,
        "/downloads/frieren-e01.mp4",
        "/downloads/frieren-e01.mp4.tmp",
        0,
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      );

      runMigrations(db, "data");
      const jobs = new DownloadJobsRepository(db);
      jobs.enqueue({
        id: "new-2",
        titleId: "anilist:1",
        titleName: "Frieren",
        mediaKind: "anime",
        contentType: "series",
        season: 1,
        episode: 2,
        providerId: "allanime",
        mode: "anime",
        streamUrl: "https://example.invalid/new.m3u8",
        headers: {},
        outputPath: "/downloads/frieren-e02.mp4",
        tempPath: "/downloads/frieren-e02.mp4.tmp",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
      });

      const persisted = jobs.listByTitle("anilist:1");
      expect(persisted.map((job) => job.contentType)).toEqual(["series", undefined]);
      const groups = groupOfflineLibraryEntries(
        persisted.map((job) => ({ job, status: "ready" as const })),
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]?.entries.map((entry) => entry.job.episode)).toEqual([1, 2]);
    } finally {
      Bun.gc(true);
      (db as unknown as { clearQueryCache?: () => void }).clearQueryCache?.();
      db.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("offline previews prefer local thumbnails and avoid remote artwork while offline", () => {
    const posterOnly = minimalJob({
      id: "poster",
      posterUrl: "https://img.example/poster.jpg",
    });
    const thumbnail = minimalJob({
      id: "thumb",
      posterUrl: "https://img.example/poster.jpg",
      thumbnailPath: "/downloads/demo.thumbnail.jpg",
    });

    expect(resolveOfflineJobPreviewImage(thumbnail)).toBe("/downloads/demo.thumbnail.jpg");
    expect(resolveOfflineJobPreviewImage(posterOnly)).toBeUndefined();
    expect(
      resolveOfflineJobPreviewImage(posterOnly, {
        networkAvailable: true,
        artworkPreviewsEnabled: true,
      }),
    ).toBe("https://img.example/poster.jpg");
    expect(
      groupOfflineLibraryEntries([{ job: posterOnly, status: "ready" }], {
        networkAvailable: false,
        artworkPreviewsEnabled: true,
      })[0]?.previewImageUrl,
    ).toBeUndefined();
  });

  test("artifact hydration marks readable non-empty files as ready", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-offline-ready-"));
    try {
      const outputPath = join(dir, "demo.mp4");
      await writeFile(outputPath, "video");

      await expect(resolveOfflineArtifactStatus(minimalJob({ id: "1", outputPath }))).resolves.toBe(
        "ready",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("artifact hydration marks absent files as missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-offline-missing-"));
    try {
      await expect(
        resolveOfflineArtifactStatus(minimalJob({ id: "1", outputPath: join(dir, "missing.mp4") })),
      ).resolves.toBe("missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("artifact hydration marks directories and empty files as invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-offline-invalid-"));
    try {
      const emptyFile = join(dir, "empty.mp4");
      const nestedDir = join(dir, "folder.mp4");
      await writeFile(emptyFile, "");
      await mkdir(nestedDir);

      await expect(
        resolveOfflineArtifactStatus(minimalJob({ id: "empty", outputPath: emptyFile })),
      ).resolves.toBe("invalid-file");
      await expect(
        resolveOfflineArtifactStatus(minimalJob({ id: "dir", outputPath: nestedDir })),
      ).resolves.toBe("invalid-file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
