import { describe, expect, test } from "bun:test";

import { formatOfflineHistoryProgress } from "@/services/offline/offline-history-progress";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import type { DownloadJobRecord } from "@kunai/storage";

function job(patch: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "title-1",
    titleName: "Demo",
    mediaKind: "series",
    season: 1,
    episode: 2,
    providerId: "vidking",
    streamUrl: "https://provider.example/stream.m3u8",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/tmp/demo.mp4",
    tempPath: "/tmp/demo.tmp",
    retryCount: 0,
    attempt: 1,
    maxAttempts: 3,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    completedAt: "2026-05-14T00:00:00.000Z",
    ...patch,
  };
}

function history(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Demo",
    type: "series",
    season: 1,
    episode: 2,
    timestamp: 600,
    duration: 1_200,
    completed: false,
    provider: "vidking",
    watchedAt: "2026-05-15T00:00:00.000Z",
    ...patch,
  };
}

describe("offline history progress", () => {
  test("shows resume progress for the matching offline episode only", () => {
    expect(
      formatOfflineHistoryProgress(job(), [
        history({ episode: 1, timestamp: 1_000, duration: 1_200 }),
        history({ timestamp: 600, duration: 1_200 }),
      ]),
    ).toBe("resume 10:00 · 50% watched");
  });

  test("shows watched for completed local history", () => {
    expect(formatOfflineHistoryProgress(job(), [history({ completed: true })])).toBe("watched");
  });

  test("falls back to job duration when history has no duration", () => {
    expect(
      formatOfflineHistoryProgress(job({ durationMs: 2_400_000 }), [
        history({ timestamp: 600, duration: undefined }),
      ]),
    ).toBe("resume 10:00 · 25% watched");
  });
});
