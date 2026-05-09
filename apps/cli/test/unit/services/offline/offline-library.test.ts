import { describe, expect, test } from "bun:test";

import {
  formatOfflineJobListingTitle,
  formatOfflineSecondaryLine,
  offlineStatusIcon,
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
});
