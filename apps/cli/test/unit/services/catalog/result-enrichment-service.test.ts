import { describe, expect, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import {
  ResultEnrichmentService,
  buildResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

function result(patch: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "title-1",
    type: "series",
    title: "Demo",
    year: "2026",
    overview: "",
    posterPath: null,
    ...patch,
  };
}

function history(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Demo",
    type: "series",
    season: 1,
    episode: 1,
    timestamp: 1_200,
    duration: 1_200,
    completed: true,
    provider: "vidking",
    watchedAt: "2026-05-14T00:00:00.000Z",
    ...patch,
  };
}

describe("ResultEnrichmentService", () => {
  test("builds watched and downloaded badges from local state", async () => {
    const service = new ResultEnrichmentService({
      historyStore: { getAll: async () => ({ "title-1": history() }) },
      offlineLibraryService: {
        validateCompletedArtifacts: async () =>
          [
            {
              status: "ready",
              job: { titleId: "title-1" },
            },
          ] as unknown as readonly OfflineLibraryEntry[],
      },
      now: () => 1,
      ttlMs: 1_000,
    });

    const enrichments = await service.enrichResults([result()]);

    expect(enrichments.get("series:title-1")?.badges).toEqual([
      { label: "watched", tone: "success" },
      { label: "downloaded", tone: "success" },
    ]);
  });

  test("keeps enrichment non-blocking when one source fails", async () => {
    const service = new ResultEnrichmentService({
      historyStore: {
        getAll: async () => ({ "title-1": history({ completed: false, timestamp: 300 }) }),
      },
      offlineLibraryService: {
        validateCompletedArtifacts: async () => {
          throw new Error("offline unavailable");
        },
      },
      now: () => 1,
      ttlMs: 1_000,
    });

    const enrichments = await service.enrichResults([result()]);

    expect(enrichments.get("series:title-1")?.badges).toEqual([
      { label: "continue S01E01 · 5:00 (25%)", tone: "warning" },
    ]);
  });

  test("describes partial progress with episode timestamp and percentage", () => {
    expect(
      buildResultEnrichment({
        result: result(),
        historyEntry: history({
          completed: false,
          season: 2,
          episode: 7,
          timestamp: 1_800,
          duration: 3_600,
        }),
      }).badges,
    ).toEqual([{ label: "continue S02E07 · 30:00 (50%)", tone: "warning" }]);
  });

  test("prefers a new episode badge over watched when cached release data moved ahead", () => {
    expect(
      buildResultEnrichment({
        result: result(),
        historyEntry: history({ episode: 5 }),
        nextRelease: {
          season: 1,
          episode: 6,
          status: "released",
          releaseAt: "2026-05-17T12:00:00.000Z",
        },
      }).badges,
    ).toEqual([{ label: "new S01E06", tone: "info" }]);
  });

  test("uses provider release metadata without probing schedule cache", async () => {
    const releaseLookups: string[] = [];
    const service = new ResultEnrichmentService({
      historyStore: { getAll: async () => ({}) },
      offlineLibraryService: {
        validateCompletedArtifacts: async () => [],
      },
      getCachedNextRelease: (searchResult) => {
        releaseLookups.push(searchResult.id);
        return null;
      },
      now: () => 1,
      ttlMs: 1_000,
    });

    const enrichments = await service.enrichResults([
      result({
        release: {
          status: "released",
          providerConfirmed: true,
          availableAt: "2026-05-19T12:00:00.000Z",
        },
      }),
    ]);

    expect(releaseLookups).toEqual([]);
    expect(enrichments.get("series:title-1")?.badges).toEqual([
      { label: "provider confirmed", tone: "success" },
    ]);
  });

  test("uses cached next-release data without probing schedules for unrelated results", async () => {
    const releaseLookups: string[] = [];
    const service = new ResultEnrichmentService({
      historyStore: {
        getAll: async () => ({
          "anilist:1": history({ episode: 5 }),
        }),
      },
      offlineLibraryService: {
        validateCompletedArtifacts: async () => [],
      },
      getCachedNextRelease: (searchResult) => {
        releaseLookups.push(searchResult.id);
        return {
          season: 1,
          episode: 6,
          status: "released",
          releaseAt: "2026-05-17T12:00:00.000Z",
        };
      },
      now: () => 1,
      ttlMs: 1_000,
    });

    const enrichments = await service.enrichResults([
      result({ id: "anilist:1" }),
      result({ id: "anilist:2" }),
    ]);

    expect(releaseLookups).toEqual(["anilist:1"]);
    expect(enrichments.get("series:anilist:1")?.badges).toEqual([
      { label: "new S01E06", tone: "info" },
    ]);
    expect(enrichments.get("series:anilist:2")?.badges).toEqual([]);
  });

  test("uses cached enrichments within the ttl", async () => {
    let offlineCalls = 0;
    const service = new ResultEnrichmentService({
      historyStore: { getAll: async () => ({}) },
      offlineLibraryService: {
        validateCompletedArtifacts: async () => {
          offlineCalls += 1;
          return [];
        },
      },
      now: () => 1,
      ttlMs: 1_000,
    });

    await service.enrichResults([result()]);
    await service.enrichResults([result()]);

    expect(offlineCalls).toBe(1);
  });

  test("marks broken local artifacts as offline issues", () => {
    expect(
      buildResultEnrichment({
        result: result(),
        offlineStatuses: ["missing"],
      }).badges,
    ).toEqual([{ label: "offline issue", tone: "warning" }]);
  });
});
