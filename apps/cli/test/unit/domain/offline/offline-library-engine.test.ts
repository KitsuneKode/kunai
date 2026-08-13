import { describe, expect, test } from "bun:test";

import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { DownloadJobRecord } from "@kunai/storage";

function job(patch: Partial<DownloadJobRecord> & Pick<DownloadJobRecord, "id">): DownloadJobRecord {
  return {
    titleId: "demo",
    titleName: "Demo",
    mediaKind: "series",
    providerId: "vidking",
    streamUrl: "https://example/stream.m3u8",
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

describe("OfflineLibraryEngine", () => {
  test("groups local entries by title and exposes premium shelf copy", () => {
    const engine = createOfflineLibraryEngine();
    const entries: OfflineLibraryEntry[] = [
      {
        job: job({
          id: "a",
          titleId: "solo",
          titleName: "Solo Leveling",
          season: 1,
          episode: 1,
          fileSize: 100,
          thumbnailPath: "/downloads/solo-s01e01.thumbnail.jpg",
        }),
        status: "ready",
      },
      {
        job: job({
          id: "b",
          titleId: "solo",
          titleName: "Solo Leveling",
          season: 1,
          episode: 2,
          completedAt: "2026-05-02T00:00:00.000Z",
        }),
        status: "missing",
      },
    ];

    const shelf = engine.buildShelf(entries);

    expect(shelf.summary).toBe("1 title · 2 local items · local-only");
    expect(shelf.groups[0]?.label).toBe("Solo Leveling");
    expect(shelf.groups[0]?.detail).toContain("1 ready");
    expect(shelf.groups[0]?.nextPlayableEpisodeLabel).toBe("S01E01");
    expect(shelf.groups[0]?.actionSummary).toBe(
      "Play S01E01 · inspect 2 episodes · repair 1 issue",
    );
    expect(shelf.groups[0]?.artifactSummary).toBe(
      "artwork ready · subtitles missing · timing missing",
    );
    expect(shelf.groups[0]?.previewImageUrl).toBe("/downloads/solo-s01e01.thumbnail.jpg");
    expect(shelf.groups[0]?.entries.map((entry) => entry.presentation.positionLabel)).toEqual([
      "S01E01",
      "S01E02",
    ]);
    expect(shelf.groups[0]?.entries[0]?.presentation).toMatchObject({
      title: "Solo Leveling",
      kindLabel: "Series",
      position: { kind: "episode", season: 1, episode: 1, seasonIsMeaningful: true },
      itemNoun: "episode",
    });
    expect(shelf.groups[0]?.entries[0]?.previewImageUrl).toBe(
      "/downloads/solo-s01e01.thumbnail.jpg",
    );
  });

  test("carries canonical presentation for a legacy synthetic movie row", () => {
    const shelf = createOfflineLibraryEngine().buildShelf([
      {
        job: job({
          id: "m",
          titleId: "dune",
          titleName: "Dune: Part Two",
          mediaKind: "movie",
          season: 1,
          episode: 1,
        }),
        status: "ready",
      },
    ]);

    const group = shelf.groups[0];
    expect(group?.entries[0]?.presentation).toMatchObject({
      kindLabel: "Movie",
      position: { kind: "title" },
      positionLabel: null,
      itemNoun: "movie",
    });
    expect(group?.nextPlayableEpisodeLabel).toBe("Movie");
    expect(group?.actionSummary).toBe("Play Movie · inspect 1 movie");
    expect(JSON.stringify(shelf)).not.toContain("S01E01");
  });

  test("anime shelf entries are episode-only by default", () => {
    const shelf = createOfflineLibraryEngine().buildShelf([
      {
        job: job({
          id: "a",
          titleId: "frieren",
          titleName: "Frieren",
          mediaKind: "anime",
          season: 1,
          episode: 3,
        }),
        status: "ready",
      },
    ]);

    expect(shelf.groups[0]?.entries[0]?.presentation.positionLabel).toBe("E03");
    expect(shelf.groups[0]?.nextPlayableEpisodeLabel).toBe("E03");
    expect(shelf.groups[0]?.actionSummary).toBe("Play E03 · inspect 1 episode");
  });

  test("keeps empty shelf actionable without network work", () => {
    const shelf = createOfflineLibraryEngine().buildShelf([]);

    expect(shelf.summary).toBe("No completed local videos yet");
    expect(shelf.emptyActions).toEqual(["Open downloads queue", "Search online"]);
  });
});
