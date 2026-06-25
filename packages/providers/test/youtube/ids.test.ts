import { describe, expect, test } from "bun:test";

import {
  extractYoutubeVideoIdFromUrl,
  isYoutubeWatchUrl,
  parseYoutubeCatalogId,
  toYoutubeChannelCatalogId,
} from "@kunai/providers/youtube";

describe("youtube ids", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extractYoutubeVideoIdFromUrl(%s)", (url, expected) => {
    expect(isYoutubeWatchUrl(url)).toBe(true);
    expect(extractYoutubeVideoIdFromUrl(url)).toBe(expected);
  });

  test("parseYoutubeCatalogId recognizes channel prefix", () => {
    const channelId = "UCxxxxxxxxxxx";
    expect(parseYoutubeCatalogId(toYoutubeChannelCatalogId(channelId))).toEqual({
      kind: "channel",
      nativeId: channelId,
    });
  });

  test("parseYoutubeCatalogId tolerates legacy youtube:video: prefix", () => {
    expect(parseYoutubeCatalogId("youtube:video:dQw4w9WgXcQ")).toEqual({
      kind: "video",
      nativeId: "dQw4w9WgXcQ",
    });
  });
});
