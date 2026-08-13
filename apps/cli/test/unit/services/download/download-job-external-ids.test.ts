import { describe, expect, test } from "bun:test";

import { downloadJobExternalIds } from "@/services/download/DownloadService";
import type { DownloadJobRecord } from "@kunai/storage";

function job(partial: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "21",
    titleName: "One Piece",
    mediaKind: "anime",
    providerId: "allmanga",
    mode: "anime",
    streamUrl: "",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/tmp/x.mp4",
    tempPath: "/tmp/x.mp4.tmp",
    retryCount: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...partial,
  };
}

describe("downloadJobExternalIds", () => {
  test("returns the persisted bag verbatim", () => {
    expect(downloadJobExternalIds(job({ externalIds: { malId: "21" } }))).toEqual({ malId: "21" });
  });

  test("never invents an AniList id for a bare numeric anime title id", () => {
    // The old derivation read `titleId.replace(/^anilist:/, "")` and, finding
    // digits, asserted `{ anilistId: "21" }`. For a MAL-only anime that names a
    // different work entirely, and it was fed straight back into re-resolve.
    expect(downloadJobExternalIds(job())).toBeUndefined();
  });

  test("recovers only what a prefixed legacy title id genuinely encodes", () => {
    expect(
      downloadJobExternalIds(job({ titleId: "tmdb:1339713", mediaKind: "movie", mode: "series" })),
    ).toEqual({ tmdbId: "1339713" });
    expect(downloadJobExternalIds(job({ titleId: "anilist:21" }))).toEqual({ anilistId: "21" });
    expect(
      downloadJobExternalIds(job({ titleId: "youtube:abc", mediaKind: "video", mode: "youtube" })),
    ).toEqual({ youtubeId: "abc" });
  });
});
