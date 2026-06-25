import { describe, expect, test } from "bun:test";

import { normalizeYtDlpVideoInfo } from "../../src/youtube/metadata-normalize";
import { YOUTUBE_METADATA_SCHEMA_VERSION } from "../../src/youtube/youtube-metadata";
import { createYoutubeMetadataService } from "../../src/youtube/youtube-metadata-service";

describe("createYoutubeMetadataService", () => {
  test("returns cached metadata on hit", async () => {
    const cached = normalizeYtDlpVideoInfo({ id: "vid1", title: "Cached", formats: [] }, "vid1");
    const service = createYoutubeMetadataService({
      cache: {
        get: () => cached,
        set: () => {},
      },
      extract: async () => {
        throw new Error("extract should not run on cache hit");
      },
    });

    await expect(service.getOrFetch("vid1", "https://youtube.com/watch?v=vid1")).resolves.toEqual(
      cached,
    );
  });

  test("fetches and stores normalized metadata on miss", async () => {
    const stored: Array<{ videoId: string; metadata: unknown }> = [];
    const service = createYoutubeMetadataService({
      cache: {
        get: () => null,
        set: (videoId, metadata) => {
          stored.push({ videoId, metadata });
        },
      },
      extract: async () => ({
        id: "vid2",
        title: "Fresh",
        duration: 90,
        formats: [{ format_id: "22", height: 720, vcodec: "avc1", acodec: "mp4a", tbr: 2000 }],
      }),
    });

    const metadata = await service.getOrFetch("vid2", "https://youtube.com/watch?v=vid2");
    expect(metadata?.schemaVersion).toBe(YOUTUBE_METADATA_SCHEMA_VERSION);
    expect(metadata?.title).toBe("Fresh");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.videoId).toBe("vid2");
  });

  test("get reads through cache port", () => {
    const cached = normalizeYtDlpVideoInfo({ id: "vid3", title: "Direct", formats: [] }, "vid3");
    const service = createYoutubeMetadataService({
      cache: {
        get: (videoId) => (videoId === "vid3" ? cached : null),
        set: () => {},
      },
    });
    expect(service.get("vid3")?.title).toBe("Direct");
    expect(service.get("missing")).toBeNull();
  });
});
