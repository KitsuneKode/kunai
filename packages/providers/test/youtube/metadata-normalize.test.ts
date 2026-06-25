import { describe, expect, test } from "bun:test";

import {
  normalizeYtDlpVideoInfo,
  parseCachedYoutubeMetadata,
} from "../../src/youtube/metadata-normalize";
import { YOUTUBE_METADATA_SCHEMA_VERSION } from "../../src/youtube/youtube-metadata";

describe("normalizeYtDlpVideoInfo", () => {
  test("maps yt-dlp -J payload into compact v2 metadata", () => {
    const metadata = normalizeYtDlpVideoInfo(
      {
        id: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        duration: 212,
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        uploader: "Rick Astley",
        channel_id: "UCuAXFkgsw1L7xaCfnd5JJOw",
        view_count: 1_500_000_000,
        upload_date: "20091025",
        formats: [
          { format_id: "18", height: 360, vcodec: "avc1", acodec: "mp4a", tbr: 500 },
          { format_id: "22", height: 720, vcodec: "avc1", acodec: "mp4a", tbr: 2000 },
          { format_id: "137", height: 1080, vcodec: "avc1", acodec: "none", tbr: 5000 },
        ],
        subtitles: {
          en: [{ ext: "vtt", url: "https://example.com/en.vtt" }],
        },
        automatic_captions: {
          en: [{ ext: "vtt", url: "https://example.com/en-auto.vtt" }],
          es: [{ ext: "vtt", url: "https://example.com/es-auto.vtt" }],
        },
      },
      "dQw4w9WgXcQ",
    );

    expect(metadata).toMatchObject({
      schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
      videoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      durationSeconds: 212,
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      uploader: "Rick Astley",
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      viewCount: 1_500_000_000,
      uploadDate: "20091025",
    });
    expect(
      [...metadata.qualities]
        .sort((left, right) => right.rank - left.rank)
        .map((entry) => entry.label),
    ).toEqual(["1080p", "720p", "360p"]);
    expect(metadata.subtitles).toHaveLength(2);
    expect(metadata.subtitles.find((track) => track.language === "en")?.source).toBe("manual");
    expect(metadata.subtitles.find((track) => track.language === "es")?.source).toBe("auto");
  });
});

describe("parseCachedYoutubeMetadata", () => {
  test("returns v2 payloads without re-normalizing", () => {
    const payload = JSON.stringify({
      schemaVersion: YOUTUBE_METADATA_SCHEMA_VERSION,
      videoId: "abc123",
      title: "Cached title",
      qualities: [],
      subtitles: [],
    });
    expect(parseCachedYoutubeMetadata(payload, "abc123")?.title).toBe("Cached title");
  });

  test("lazy-migrates legacy full yt-dlp blobs", () => {
    const legacy = JSON.stringify({
      id: "abc123",
      title: "Legacy title",
      duration: 42,
      formats: [{ format_id: "18", height: 360, vcodec: "avc1", acodec: "mp4a", tbr: 500 }],
    });
    const migrated = parseCachedYoutubeMetadata(legacy, "abc123");
    expect(migrated?.schemaVersion).toBe(YOUTUBE_METADATA_SCHEMA_VERSION);
    expect(migrated?.title).toBe("Legacy title");
    expect(migrated?.durationSeconds).toBe(42);
  });
});
