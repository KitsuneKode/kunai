import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatOfflineJobListingTitle,
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
