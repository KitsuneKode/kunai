import { describe, expect, test } from "bun:test";

import { ReleaseReconciliationService } from "@/services/release-reconciliation/ReleaseReconciliationService";
import type { ReleaseReconciliationHistoryRow } from "@/services/release-reconciliation/types";
import type { ReleaseProgressProjection } from "@kunai/storage";

function row(
  patch: Partial<ReleaseReconciliationHistoryRow> = {},
): ReleaseReconciliationHistoryRow {
  return {
    titleId: "anilist:1",
    mediaKind: "series",
    title: "Demo",
    season: 1,
    episode: 6,
    completed: true,
    externalIds: { anilistId: "1" },
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...patch,
  };
}

describe("ReleaseReconciliationService", () => {
  test("writes catalog-only new episode projections from one batched loader pass", async () => {
    const repo = new MemoryReleaseProgressRepository();
    let loaderCalls = 0;
    let loadedCandidateCount = 0;
    const service = new ReleaseReconciliationService({
      repository: repo,
      loadProgress: async (candidates) => {
        loaderCalls += 1;
        loadedCandidateCount += candidates.length;
        return candidates.map((candidate) => ({
          candidate,
          latestAiredSeason: 1,
          latestAiredEpisode: candidate.catalogId === "1" ? 8 : 3,
          nextAiringSeason: 1,
          nextAiringEpisode: candidate.catalogId === "1" ? 9 : 4,
          nextAiringAt: "2026-05-30T10:00:00.000Z",
          latestKnownReleaseAt: "2026-05-23T10:00:00.000Z",
          sourceFingerprint: `${candidate.source}:${candidate.catalogId}`,
        }));
      },
    });

    const result = await service.reconcile({
      trigger: "history",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [
        row({ titleId: "anilist:1", externalIds: { anilistId: "1" }, episode: 6 }),
        row({ titleId: "anilist:1", externalIds: { anilistId: "1" }, episode: 2 }),
        row({ titleId: "anilist:2", externalIds: { anilistId: "2" }, episode: 3 }),
      ],
    });

    expect(loaderCalls).toBe(1);
    expect(loadedCandidateCount).toBe(2);
    expect(result).toMatchObject({ candidateCount: 2, fetchedCount: 2, writtenCount: 2 });
    expect(repo.rows.get("anilist:1")).toMatchObject({
      titleId: "anilist:1",
      anchorEpisode: 6,
      latestAiredEpisode: 8,
      newEpisodeCount: 2,
      status: "new-episodes",
    });
    expect(repo.rows.get("anilist:2")).toMatchObject({
      newEpisodeCount: 0,
      status: "upcoming",
    });
  });

  test("keeps stale projection when catalog load fails and schedules backoff", async () => {
    const repo = new MemoryReleaseProgressRepository();
    repo.upsert({
      titleId: "anilist:1",
      mediaKind: "series",
      source: "anilist",
      title: "Demo",
      anchorEpisode: 6,
      latestAiredEpisode: 7,
      newEpisodeCount: 1,
      status: "new-episodes",
      checkedAt: "2026-05-22T12:00:00.000Z",
      nextCheckAt: "2026-05-23T12:00:00.000Z",
      staleAfterAt: "2026-05-24T12:00:00.000Z",
      sourceFingerprint: "old",
      errorCount: 0,
    });
    const service = new ReleaseReconciliationService({
      repository: repo,
      loadProgress: async () => {
        throw new Error("rate limited");
      },
    });

    const result = await service.reconcile({
      trigger: "history",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [row()],
    });

    expect(result).toMatchObject({ candidateCount: 1, fetchedCount: 0, writtenCount: 1 });
    expect(repo.rows.get("anilist:1")).toMatchObject({
      latestAiredEpisode: 7,
      newEpisodeCount: 1,
      status: "new-episodes",
      errorCount: 1,
      lastError: "rate limited",
      nextCheckAt: "2026-05-23T12:15:00.000Z",
    });
  });

  test("writes an unknown backoff projection for a newly observed title after catalog failure", async () => {
    const repo = new MemoryReleaseProgressRepository();
    const service = new ReleaseReconciliationService({
      repository: repo,
      loadProgress: async () => {
        throw new Error("catalog unavailable");
      },
    });

    await service.reconcile({
      trigger: "history",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [row()],
    });

    expect(repo.rows.get("anilist:1")).toMatchObject({
      status: "unknown",
      newEpisodeCount: 0,
      errorCount: 1,
      lastError: "catalog unavailable",
      nextCheckAt: "2026-05-23T12:15:00.000Z",
    });
  });

  test("preserves anime media kind in the derived projection", async () => {
    const repo = new MemoryReleaseProgressRepository();
    const service = new ReleaseReconciliationService({
      repository: repo,
      loadProgress: async ([candidate]) =>
        candidate
          ? [
              {
                candidate,
                latestAiredEpisode: 7,
                sourceFingerprint: "anime:7",
              },
            ]
          : [],
    });

    await service.reconcile({
      trigger: "history",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [
        row({
          titleId: "anilist:99",
          mediaKind: "anime",
          externalIds: { anilistId: "99" },
        }),
      ],
    });

    expect(repo.rows.get("anilist:99")?.mediaKind).toBe("anime");
  });
});

class MemoryReleaseProgressRepository {
  readonly rows = new Map<string, ReleaseProgressProjection>();

  getByTitleIds(titleIds: readonly string[]): Map<string, ReleaseProgressProjection> {
    return new Map(
      titleIds.flatMap((id) => {
        const cached = this.rows.get(id);
        return cached ? [[id, cached] as const] : [];
      }),
    );
  }

  upsert(input: ReleaseProgressProjection): void {
    this.rows.set(input.titleId, input);
  }
}
