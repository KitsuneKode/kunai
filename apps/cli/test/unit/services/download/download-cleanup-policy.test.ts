import { describe, expect, test } from "bun:test";

import { selectDownloadCleanupCandidates } from "@/services/download/download-cleanup-policy";
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
    outputPath: "/downloads/demo.mp4",
    tempPath: "/downloads/demo.tmp",
    retryCount: 0,
    attempt: 1,
    maxAttempts: 3,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    completedAt: "2026-05-01T00:00:00.000Z",
    ...patch,
  };
}

function watched(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Demo",
    type: "series",
    season: 1,
    episode: 2,
    timestamp: 1_200,
    duration: 1_200,
    completed: true,
    provider: "local:vidking",
    watchedAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

describe("download cleanup policy", () => {
  test("selects watched completed downloads after the grace period", () => {
    const record = job();
    const candidates = selectDownloadCleanupCandidates({
      jobs: [record],
      historyByTitle: new Map([[record.titleId, [watched()]]]),
      nowMs: Date.parse("2026-05-14T00:00:00.000Z"),
      graceDays: 2,
    });

    expect(candidates).toEqual([
      {
        job: record,
        reason: "watched",
        watchedAt: "2026-05-10T00:00:00.000Z",
      },
    ]);
  });

  test("never selects unwatched, pinned, or protected next episodes", () => {
    const watchedRecord = job({ id: "watched" });
    const pinnedRecord = job({ id: "pinned", episode: 3 });
    const nextRecord = job({ id: "next", episode: 4 });
    const candidates = selectDownloadCleanupCandidates({
      jobs: [watchedRecord, pinnedRecord, nextRecord],
      historyByTitle: new Map([
        ["title-1", [watched(), watched({ episode: 3 }), watched({ episode: 4 })]],
      ]),
      nowMs: Date.parse("2026-05-14T00:00:00.000Z"),
      graceDays: 2,
      pinnedJobIds: new Set(["pinned"]),
      protectedEpisodes: [{ titleId: "title-1", season: 1, episode: 4 }],
    });

    expect(candidates.map((candidate) => candidate.job.id)).toEqual(["watched"]);
  });

  test("keeps recently watched downloads inside the grace period", () => {
    const record = job();
    const candidates = selectDownloadCleanupCandidates({
      jobs: [record],
      historyByTitle: new Map([
        [record.titleId, [watched({ watchedAt: "2026-05-13T00:00:00.000Z" })]],
      ]),
      nowMs: Date.parse("2026-05-14T00:00:00.000Z"),
      graceDays: 2,
    });

    expect(candidates).toEqual([]);
  });
});
