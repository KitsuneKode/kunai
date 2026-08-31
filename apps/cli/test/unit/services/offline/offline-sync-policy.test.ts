import { describe, expect, test } from "bun:test";

import {
  historyMatchesDownloadJob,
  shouldAutoCleanupOfflineJob,
} from "@/services/offline/offline-sync-policy";
import type { DownloadJobRecord, HistoryProgress } from "@kunai/storage";

/**
 * This module decides whether a file the user downloaded gets deleted, and it
 * had no tests. The matching half is shared with the retention keep-set, so a
 * disagreement between them deleted episodes the policy was told to keep.
 */
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

function watched(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "title-1",
    mediaKind: "series",
    title: "Demo",
    season: 1,
    episode: 2,
    positionSeconds: 1_200,
    durationSeconds: 1_200,
    completed: true,
    providerId: "local:vidking",
    updatedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAY_20 = Date.parse("2026-05-20T00:00:00.000Z");

describe("historyMatchesDownloadJob", () => {
  test("matches a season-relative episode", () => {
    expect(historyMatchesDownloadJob(watched(), job())).toBe(true);
  });

  test("matches an absolute-numbered anime episode against a seasonless job", () => {
    // The regression this module shared with the retention keep-set: only the
    // history side was normalized, so `1 === undefined` matched nothing and an
    // absolute-numbered anime download was never recognised as watched.
    const entry = watched({
      mediaKind: "anime",
      season: undefined,
      episode: undefined,
      absoluteEpisode: 13,
    });
    const record = job({ mediaKind: "anime", season: undefined, episode: 13 });

    expect(historyMatchesDownloadJob(entry, record)).toBe(true);
  });

  test("does not match a different episode", () => {
    expect(historyMatchesDownloadJob(watched({ episode: 3 }), job())).toBe(false);
  });

  test("a movie matches on kind alone, without episode numbering", () => {
    const entry = watched({ mediaKind: "movie", season: undefined, episode: undefined });
    expect(historyMatchesDownloadJob(entry, job({ mediaKind: "movie" }))).toBe(true);
  });

  test("an anime film matches on contentType, not the anime badge", () => {
    // `mediaKind: "anime"` with `contentType: "movie"` is a film. Deriving the
    // kind from the badge alone called it a series and then demanded an episode
    // match it could never satisfy, so the film was never seen as watched.
    const entry = watched({ mediaKind: "anime", season: undefined, episode: undefined });
    const record = job({
      mediaKind: "anime",
      contentType: "movie",
      season: undefined,
      episode: undefined,
    });

    expect(historyMatchesDownloadJob(entry, record)).toBe(true);
  });

  test("an anime series is still matched by episode", () => {
    const entry = watched({
      mediaKind: "anime",
      season: undefined,
      absoluteEpisode: 13,
      episode: undefined,
    });
    const series = job({
      mediaKind: "anime",
      contentType: "series",
      season: undefined,
      episode: 13,
    });

    expect(historyMatchesDownloadJob(entry, series)).toBe(true);
    expect(historyMatchesDownloadJob(entry, job({ ...series, episode: 14 }))).toBe(false);
  });

  test("a movie job never matches an episodic history row", () => {
    expect(historyMatchesDownloadJob(watched(), job({ mediaKind: "movie" }))).toBe(false);
  });
});

describe("shouldAutoCleanupOfflineJob", () => {
  test("an unfinished download is never deleted", () => {
    const decision = shouldAutoCleanupOfflineJob({
      job: job({ status: "running" }),
      historyEntries: [watched()],
      nowMs: MAY_20,
      graceDays: 3,
    });

    expect(decision).toEqual({ shouldDelete: false, reason: "not-completed" });
  });

  test("an unwatched download is never deleted", () => {
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      historyEntries: [watched({ completed: false })],
      nowMs: MAY_20,
      graceDays: 3,
    });

    expect(decision).toEqual({ shouldDelete: false, reason: "not-watched" });
  });

  test("a watched download inside the grace window is kept", () => {
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      historyEntries: [watched({ updatedAt: new Date(MAY_20 - DAY_MS).toISOString() })],
      nowMs: MAY_20,
      graceDays: 3,
    });

    expect(decision).toEqual({ shouldDelete: false, reason: "grace-period" });
  });

  test("a watched download past the grace window is deleted", () => {
    const watchedAt = new Date(MAY_20 - 5 * DAY_MS).toISOString();
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      historyEntries: [watched({ updatedAt: watchedAt })],
      nowMs: MAY_20,
      graceDays: 3,
    });

    expect(decision).toEqual({ shouldDelete: true, reason: "watched", watchedAt });
  });

  test("an absolute-numbered anime episode is recognised as watched", () => {
    // Before the shared matcher this returned "not-watched" forever, so the
    // grace period never started and the file was never reclaimed.
    const watchedAt = new Date(MAY_20 - 5 * DAY_MS).toISOString();
    const decision = shouldAutoCleanupOfflineJob({
      job: job({ mediaKind: "anime", season: undefined, episode: 13 }),
      historyEntries: [
        watched({
          mediaKind: "anime",
          season: undefined,
          episode: undefined,
          absoluteEpisode: 13,
          updatedAt: watchedAt,
        }),
      ],
      nowMs: MAY_20,
      graceDays: 3,
    });

    expect(decision).toEqual({ shouldDelete: true, reason: "watched", watchedAt });
  });

  test("a corrupt updatedAt is not treated as a watch", () => {
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      historyEntries: [watched({ updatedAt: "not-a-date" })],
      nowMs: MAY_20,
      graceDays: 3,
    });

    expect(decision).toEqual({ shouldDelete: false, reason: "not-watched" });
  });

  test("a zero grace period deletes as soon as it is watched", () => {
    const watchedAt = new Date(MAY_20 - 1).toISOString();
    const decision = shouldAutoCleanupOfflineJob({
      job: job(),
      historyEntries: [watched({ updatedAt: watchedAt })],
      nowMs: MAY_20,
      graceDays: 0,
    });

    expect(decision).toEqual({ shouldDelete: true, reason: "watched", watchedAt });
  });
});
