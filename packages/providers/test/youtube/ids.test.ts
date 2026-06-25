import { describe, expect, test } from "bun:test";

import {
  extractYoutubeVideoIdFromUrl,
  isYoutubeCollectionCatalogId,
  isYoutubeWatchUrl,
  parseYoutubeCatalogId,
  toYoutubeChannelCatalogId,
} from "@kunai/providers/youtube";

describe("youtube ids", () => {
  test.each([
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
    { url: "https://youtu.be/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
    { url: "https://www.youtube.com/live/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
    { url: "https://www.youtube.com/shorts/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  ])("extractYoutubeVideoIdFromUrl($url)", ({ url, expected }) => {
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

  test("detects channel and playlist catalog ids", () => {
    expect(isYoutubeCollectionCatalogId("youtube-channel:UC123")).toBe(true);
    expect(isYoutubeCollectionCatalogId("youtube-playlist:PL123")).toBe(true);
    expect(isYoutubeCollectionCatalogId("youtube:abc12345678")).toBe(false);
  });
});
