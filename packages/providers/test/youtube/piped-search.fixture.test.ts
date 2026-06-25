import { describe, expect, test } from "bun:test";

import { mapPipedSearchItem } from "@kunai/providers/youtube";

describe("mapPipedSearchItem", () => {
  test("maps Piped video rows with metadata source", () => {
    const mapped = mapPipedSearchItem({
      url: "/watch?v=dQw4w9WgXcQ",
      title: "Sample video",
      duration: 212,
      uploaderName: "Uploader",
      views: 1_000,
      uploaded: Date.UTC(2020, 0, 1),
      thumbnail: "https://example.com/thumb.jpg",
      shortDescription: "Short desc",
    });

    expect(mapped?.metadataSource).toBe("Piped");
    expect(mapped?.externalIds?.youtubeId).toBe("dQw4w9WgXcQ");
    expect(mapped?.durationSeconds).toBe(212);
    expect(mapped?.channelTitle).toBe("Uploader");
    expect(mapped?.liveStatus).toBe("none");
  });

  test("returns null when video id or title missing", () => {
    expect(mapPipedSearchItem({ url: "/watch?v=abc", title: "" })).toBeNull();
    expect(mapPipedSearchItem({ url: "/channel/xyz", title: "Channel" })).toBeNull();
  });
});
