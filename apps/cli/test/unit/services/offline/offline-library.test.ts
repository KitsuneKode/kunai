import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatOfflineJobListingTitle,
  formatOfflineLibraryGroupDetail,
  formatOfflineLibraryGroupLabel,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  groupOfflineLibraryEntries,
  formatOfflineSecondaryLine,
  offlineStatusIcon,
  resolveOfflineArtifactStatus,
} from "@/services/offline/offline-library";
import type { DownloadJobRecord } from "@kunai/storage";

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

  test("offline shelf copy surfaces readiness before filesystem noise", () => {
    const job = minimalJob({
      id: "1",
      titleName: "Example",
      season: 1,
      episode: 4,
      fileSize: 15_728_640,
      subtitlePath: "/downloads/example.srt",
      introSkipJson: JSON.stringify({ openings: [] }),
      posterUrl: "https://img.example/poster.jpg",
      thumbnailPath: "/downloads/example.thumbnail.jpg",
      outputPath: "/downloads/Example/episode-4.mp4",
    });

    expect(formatOfflineShelfBadge(job, "ready")).toBe("offline ready");
    expect(formatOfflineShelfDetail(job, "ready")).toBe(
      "S01E04 · 15.0 MB · subtitles cached · timing cached · thumbnail ready · Example",
    );
    expect(formatOfflineShelfBadge(job, "missing")).toBe("file missing");
  });

  test("offline library groups completed files by title before showing episodes", () => {
    const groups = groupOfflineLibraryEntries([
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
    ]);

    expect(groups.map((group) => group.titleName)).toEqual(["Solo Leveling", "Breaking Bad"]);
    expect(formatOfflineLibraryGroupLabel(groups[1]!)).toBe("Breaking Bad  ·  2 episodes");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("1 ready");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("1 needs attention");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("artwork ready");
    expect(formatOfflineLibraryGroupDetail(groups[1]!)).toContain("timing cached");
    expect(groups[1]!.previewImageUrl).toBe("https://img.example/bb.jpg");
    expect(groups[1]!.entries.map((entry) => entry.job.episode)).toEqual([1, 2]);
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
