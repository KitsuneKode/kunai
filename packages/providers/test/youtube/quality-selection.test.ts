import { describe, expect, test } from "bun:test";

import {
  selectYoutubeQuality,
  youtubeQualityHeight,
  type YoutubeQualityEntry,
} from "../../src/youtube/quality-selection";

// Sorted highest-first, exactly as mapYtDlpFormatsToQualityLabels emits them.
const LADDER: readonly YoutubeQualityEntry[] = [
  { label: "1080p", rank: 1080, formatId: "137" },
  { label: "480p", rank: 480, formatId: "135" },
  { label: "144p", rank: 144, formatId: "160" },
];

describe("youtube quality selection", () => {
  test("an exact match wins", () => {
    expect(selectYoutubeQuality(LADDER, "480p")?.label).toBe("480p");
  });

  test("a missing ceiling rounds DOWN, never up", () => {
    // The bug: 720p is absent, and the list is highest-first, so falling back to
    // entries[0] handed back 1080p — above the cap the user set.
    expect(selectYoutubeQuality(LADDER, "720p")?.label).toBe("480p");
  });

  test("best takes the highest rendition", () => {
    expect(selectYoutubeQuality(LADDER, "best")?.label).toBe("1080p");
    expect(selectYoutubeQuality(LADDER, undefined)?.label).toBe("1080p");
  });

  test("a ceiling below everything takes the smallest, not the largest", () => {
    expect(selectYoutubeQuality(LADDER, "120p")?.label).toBe("144p");
  });

  test("an empty ladder selects nothing instead of throwing", () => {
    expect(selectYoutubeQuality([], "720p")).toBeUndefined();
  });

  test("height parsing", () => {
    expect(youtubeQualityHeight("1080p")).toBe(1080);
    expect(youtubeQualityHeight("best")).toBeUndefined();
    expect(youtubeQualityHeight(undefined)).toBeUndefined();
  });
});
