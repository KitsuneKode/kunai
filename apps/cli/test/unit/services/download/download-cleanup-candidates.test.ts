import { describe, expect, test } from "bun:test";

import {
  collectDownloadCleanupCandidates,
  deleteDownloadCleanupCandidates,
  describeCleanupCandidate,
  formatCleanupBannerText,
  formatCleanupRecoveryHint,
  summarizeDownloadCleanupCandidates,
  type DownloadCleanupSources,
} from "@/services/download/download-cleanup-candidates";
import type { DownloadCleanupCandidate } from "@/services/download/download-cleanup-policy";
import type { DownloadJobRecord, HistoryProgress, OfflineTitlePolicyRecord } from "@kunai/storage";

const NOW = Date.parse("2026-05-14T00:00:00.000Z");

function job(patch: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "title-1",
    titleName: "Demo",
    mediaKind: "series",
    contentType: "series",
    season: 1,
    episode: 2,
    providerId: "vidking",
    streamUrl: "https://provider.example/stream.m3u8",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/downloads/demo-s1e2.mp4",
    tempPath: "/downloads/demo-s1e2.tmp",
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

function sources(patch: {
  readonly jobs?: readonly DownloadJobRecord[];
  readonly history?: readonly HistoryProgress[];
  readonly policies?: readonly OfflineTitlePolicyRecord[];
  readonly autoCleanupWatched?: boolean;
  readonly autoCleanupGraceDays?: number;
  readonly protectedDownloadJobIds?: readonly string[];
  readonly historyThrows?: boolean;
}): DownloadCleanupSources {
  const jobs = patch.jobs ?? [];
  const history = patch.history ?? [];
  return {
    config: {
      autoCleanupWatched: patch.autoCleanupWatched ?? true,
      autoCleanupGraceDays: patch.autoCleanupGraceDays ?? 2,
      protectedDownloadJobIds: patch.protectedDownloadJobIds ?? [],
    },
    downloadService: { listCompleted: () => jobs },
    historyRepository: {
      listRecent: () => {
        if (patch.historyThrows) throw new Error("history corrupt");
        return history;
      },
    },
    offlineTitlePolicies: { listByTitleIds: () => patch.policies ?? [] },
  };
}

function candidate(
  patch: Partial<DownloadJobRecord> = {},
  watchedAt = "2026-05-10T00:00:00.000Z",
): DownloadCleanupCandidate {
  return {
    job: job(patch),
    reason: "watched",
    eligibility: { kind: "grace", graceDays: 2 },
    watchedAt,
  };
}

describe("collectDownloadCleanupCandidates", () => {
  test("returns nothing when the cleanup feature is off", () => {
    const result = collectDownloadCleanupCandidates(
      sources({ jobs: [job()], history: [watched()], autoCleanupWatched: false }),
      { nowMs: NOW },
    );
    expect(result).toEqual([]);
  });

  test("returns watched downloads past the grace window", () => {
    const record = job();
    const result = collectDownloadCleanupCandidates(
      sources({ jobs: [record], history: [watched()] }),
      { nowMs: NOW },
    );
    expect(result.map((c) => c.job.id)).toEqual([record.id]);
  });

  test("honors pinned jobs and per-title keep policies", () => {
    const pinned = job({ id: "pinned", episode: 3 });
    const kept = job({ id: "kept", episode: 4 });
    const stale = job({ id: "stale", episode: 5 });
    const result = collectDownloadCleanupCandidates(
      sources({
        jobs: [pinned, kept, stale],
        history: [watched({ episode: 3 }), watched({ episode: 4 }), watched({ episode: 5 })],
        protectedDownloadJobIds: ["pinned"],
        policies: [
          {
            titleId: "title-1",
            mediaKind: "series",
            titleName: "Demo",
            enrolled: false,
            runwayTarget: 2,
            profileJson: "{}",
            cleanupJson: '{"mode":"keep-last-watched","count":2}',
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      }),
      { nowMs: NOW },
    );
    // keep-last-2 retains ep4+ep5; pinned drops ep3 — nothing remains.
    expect(result.map((c) => c.job.id)).toEqual([]);
  });

  test("survives a broken history read instead of failing the surface", () => {
    const result = collectDownloadCleanupCandidates(
      sources({ jobs: [job()], historyThrows: true }),
      { nowMs: NOW },
    );
    expect(result).toEqual([]);
  });
});

describe("cleanup summary + banner text", () => {
  test("aggregates recoverable bytes over jobs that recorded a size", () => {
    const summary = summarizeDownloadCleanupCandidates([
      candidate({ fileSize: 2 * 1024 ** 3 }),
      candidate({ id: "b", fileSize: 1 * 1024 ** 3 }),
      candidate({ id: "c" }), // no fileSize recorded
    ]);
    expect(summary).toEqual({ count: 3, totalBytes: 3 * 1024 ** 3, sizedCount: 2 });
    expect(formatCleanupBannerText(summary)).toBe(
      "3 watched downloads can be cleaned up · 3.0 GiB recoverable",
    );
  });

  test("banner omits the size when nothing recorded one", () => {
    const summary = summarizeDownloadCleanupCandidates([candidate()]);
    expect(formatCleanupBannerText(summary)).toBe("1 watched download can be cleaned up");
    expect(formatCleanupBannerText({ count: 0, totalBytes: 0, sizedCount: 0 })).toBe("");
  });
});

describe("formatCleanupRecoveryHint", () => {
  test("is empty when there is nothing to recover or cleanup is off", () => {
    expect(formatCleanupRecoveryHint(sources({ jobs: [], autoCleanupWatched: true }))).toBe("");
    expect(
      formatCleanupRecoveryHint(
        sources({ jobs: [job()], history: [watched()], autoCleanupWatched: false }),
      ),
    ).toBe("");
  });

  test("names the recoverable set and the review entry point on a disk refusal", () => {
    const hint = formatCleanupRecoveryHint(
      sources({
        jobs: [job({ fileSize: 1024 ** 3 })],
        history: [watched()],
        autoCleanupWatched: true,
      }),
    );
    expect(hint).toContain("1 watched download holds 1.0 GiB");
    expect(hint).toContain("/cleanup-downloads");
  });
});

describe("describeCleanupCandidate", () => {
  test("labels episodes with season/episode and explains the release rule", () => {
    const option = describeCleanupCandidate(candidate(), NOW);
    expect(option.jobId).toBe("job-1");
    expect(option.label).toBe("Demo S1E2");
    expect(option.detail).toContain("watched 4d ago");
    expect(option.detail).toContain("past 2d grace");
    expect(option.detail).toContain("/downloads/demo-s1e2.mp4");
  });

  test("labels movies without an episode code and keep-last releases by count", () => {
    const option = describeCleanupCandidate(
      {
        ...candidate({ contentType: "movie", season: undefined, episode: undefined }),
        eligibility: { kind: "keep-last-watched", count: 1 },
      },
      NOW,
    );
    expect(option.label).toBe("Demo");
    expect(option.detail).toContain("outside keep-last-1");
  });
});

describe("deleteDownloadCleanupCandidates", () => {
  test("deletes each candidate through deleteJob with artifact removal", async () => {
    const calls: { id: string; deleteArtifact?: boolean }[] = [];
    const report = await deleteDownloadCleanupCandidates(
      {
        deleteJob: async (id, options) => {
          calls.push({ id, deleteArtifact: options?.deleteArtifact });
        },
      },
      [candidate(), candidate({ id: "b" })],
    );
    expect(calls).toEqual([
      { id: "job-1", deleteArtifact: true },
      { id: "b", deleteArtifact: true },
    ]);
    expect(report.deleted).toHaveLength(2);
    expect(report.failed).toEqual([]);
  });

  test("reports per-item failures and keeps going", async () => {
    const report = await deleteDownloadCleanupCandidates(
      {
        deleteJob: async (id) => {
          if (id === "b") throw new Error("artifact busy");
        },
      },
      [candidate(), candidate({ id: "b" }), candidate({ id: "c" })],
    );
    expect(report.deleted.map((c) => c.job.id)).toEqual(["job-1", "c"]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.candidate.job.id).toBe("b");
    expect(report.failed[0]?.message).toBe("artifact busy");
  });
});
