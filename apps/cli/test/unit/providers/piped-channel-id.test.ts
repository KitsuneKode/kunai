import { describe, expect, test } from "bun:test";

import { extractPipedChannelId, mapPipedSearchItem } from "@kunai/providers/youtube";

describe("Piped channel id mapping", () => {
  test("extractPipedChannelId reads /channel/ paths", () => {
    expect(extractPipedChannelId("/channel/UCabcdef")).toBe("UCabcdef");
    expect(extractPipedChannelId("https://piped.example/channel/UCxyz")).toBe("UCxyz");
    expect(extractPipedChannelId("/c/VanityName")).toBeNull();
    expect(extractPipedChannelId(undefined)).toBeNull();
  });

  test("mapPipedSearchItem carries youtubeChannelId when uploaderUrl is present", () => {
    const mapped = mapPipedSearchItem({
      url: "/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      uploaderName: "Rick Astley",
      uploaderUrl: "/channel/UCuAXFkgsw1L7NyaFkawy4LQ",
      duration: 213,
      views: 1_000_000,
    });
    expect(mapped?.channelId).toBe("UCuAXFkgsw1L7NyaFkawy4LQ");
    expect(mapped?.externalIds?.youtubeChannelId).toBe("UCuAXFkgsw1L7NyaFkawy4LQ");
    expect(mapped?.posterPath).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  });
});
