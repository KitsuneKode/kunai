import { describe, expect, test } from "bun:test";

import {
  applyYoutubeHistoryEnrichment,
  enrichYoutubeHistoryRow,
} from "@/services/youtube/youtube-history-metadata";
import { YOUTUBE_METADATA_SCHEMA_VERSION } from "@kunai/providers/youtube";
import type { HistoryProgress } from "@kunai/storage";

function baseYoutubeHistory(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "youtube:video:abc123",
    titleId: "youtube:video:abc123",
    title: "",
    mediaKind: "video",
    providerId: "youtube",
    positionSeconds: 120,
    durationSeconds: 0,
    updatedAt: new Date().toISOString(),
    completed: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("youtube history metadata enrichment", () => {
  test("fills missing title poster and duration only", () => {
    const progress = baseYoutubeHistory();
    const metadata = {
      schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
      videoId: "abc123",
      title: "Cached title",
      thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      durationSeconds: 600,
      qualities: [],
      subtitles: [],
    };
    expect(enrichYoutubeHistoryRow(progress, metadata)).toEqual({
      title: "Cached title",
      posterUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      durationSeconds: 600,
    });
  });

  test("does not overwrite populated history fields", () => {
    const progress = baseYoutubeHistory({
      title: "Saved title",
      posterUrl: "https://example.com/poster.jpg",
      durationSeconds: 300,
    });
    const metadata = {
      schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
      videoId: "abc123",
      title: "Cached title",
      thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      durationSeconds: 600,
      qualities: [],
      subtitles: [],
    };
    expect(enrichYoutubeHistoryRow(progress, metadata)).toEqual({});
    expect(applyYoutubeHistoryEnrichment(progress)).toEqual(progress);
  });
});
