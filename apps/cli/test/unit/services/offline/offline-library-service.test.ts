import { describe, expect, test } from "bun:test";

import type { PlaybackResult } from "@/domain/types";
import type { DownloadService } from "@/services/download/DownloadService";
import { shouldAutoCleanupOfflineJob } from "@/services/offline/offline-sync-policy";
import { OfflineLibraryService } from "@/services/offline/OfflineLibraryService";
import type { HistoryEntry, HistoryStore } from "@/services/persistence/HistoryStore";
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
    outputPath: import.meta.path,
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

function result(patch: Partial<PlaybackResult> = {}): PlaybackResult {
  return {
    watchedSeconds: 600,
    duration: 1_200,
    endReason: "quit",
    lastTrustedProgressSeconds: 600,
    ...patch,
  };
}

describe("OfflineLibraryService", () => {
  test("dedupes duplicate completed artifacts by newest record", async () => {
    const older = job({ id: "old", updatedAt: "2026-05-13T00:00:00.000Z" });
    const newer = job({ id: "new", updatedAt: "2026-05-14T00:00:00.000Z" });
    const service = new OfflineLibraryService({
      downloadService: {
        listCompleted: () => [older, newer],
      } as unknown as DownloadService,
      historyStore: {} as HistoryStore,
    });

    const entries = await service.listCompletedEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.job.id).toBe("new");
  });

  test("validates completed artifacts without deleting broken records", async () => {
    const broken = job({
      id: "broken",
      outputPath: `/tmp/kunai-missing-offline-artifact-${crypto.randomUUID()}.mp4`,
    });
    const service = new OfflineLibraryService({
      downloadService: {
        listCompleted: () => [broken],
        deleteJob: () => {
          throw new Error("validation must not delete records");
        },
      } as unknown as DownloadService,
      historyStore: {} as HistoryStore,
    });

    const entries = await service.validateCompletedArtifacts();

    expect(entries).toEqual([{ job: broken, status: "missing" }]);
  });

  test("builds a local playback source with subtitle sidecar and timing metadata", async () => {
    const record = job({
      subtitlePath: "/tmp/demo.srt",
      subtitleLanguage: "en",
      introSkipJson: JSON.stringify({
        tmdbId: "title-1",
        type: "tv",
        intro: [{ startMs: 10_000, endMs: 70_000 }],
        recap: [],
        credits: [],
        preview: [],
      }),
    });
    const service = new OfflineLibraryService({
      downloadService: {
        getJob: () => record,
        listCompleted: () => [record],
      } as unknown as DownloadService,
      historyStore: {} as HistoryStore,
    });

    const playable = await service.getPlayableSource(record.id);

    expect(playable.status).toBe("ready");
    if (playable.status !== "ready") throw new Error("expected playable source");
    expect(playable.source).toMatchObject({
      kind: "local",
      jobId: "job-1",
      titleId: "title-1",
      filePath: import.meta.path,
      subtitlePath: "/tmp/demo.srt",
      subtitleLanguage: "en",
      timing: {
        tmdbId: "title-1",
        intro: [{ startMs: 10_000, endMs: 70_000 }],
      },
    });
  });

  test("persists offline playback progress to history", async () => {
    const saves: { id: string; entry: HistoryEntry }[] = [];
    const service = new OfflineLibraryService({
      downloadService: {} as DownloadService,
      historyStore: {
        save: async (id: string, entry: HistoryEntry) => saves.push({ id, entry }),
      } as unknown as HistoryStore,
    });
    const source = {
      kind: "local" as const,
      jobId: "job-1",
      titleId: "title-1",
      titleName: "Demo",
      mediaKind: "series" as const,
      providerId: "vidking",
      season: 1,
      episode: 2,
      filePath: "/tmp/demo.mp4",
    };

    await service.savePlaybackHistory(source, result());

    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      id: "title-1",
      entry: {
        title: "Demo",
        season: 1,
        episode: 2,
        timestamp: 600,
        provider: "local:vidking",
      },
    });
  });
});

describe("offline sync policy", () => {
  test("allows cleanup after completed watched entry passes grace period", () => {
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      nowMs: Date.parse("2026-05-14T00:00:00.000Z"),
      graceDays: 2,
      historyEntries: [
        {
          title: "Demo",
          type: "series",
          season: 1,
          episode: 2,
          timestamp: 1_200,
          duration: 1_200,
          completed: true,
          provider: "local:vidking",
          watchedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    });

    expect(decision).toEqual({
      shouldDelete: true,
      reason: "watched",
      watchedAt: "2026-05-10T00:00:00.000Z",
    });
  });

  test("keeps recently watched downloads during cleanup grace period", () => {
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      nowMs: Date.parse("2026-05-14T00:00:00.000Z"),
      graceDays: 2,
      historyEntries: [
        {
          title: "Demo",
          type: "series",
          season: 1,
          episode: 2,
          timestamp: 1_200,
          duration: 1_200,
          completed: true,
          provider: "local:vidking",
          watchedAt: "2026-05-13T00:00:00.000Z",
        },
      ],
    });

    expect(decision).toEqual({ shouldDelete: false, reason: "grace-period" });
  });
});
