import { describe, expect, test } from "bun:test";

import { selectYoutubeQuality, youtubeQualityHeight } from "../../src/youtube/quality-selection";

describe("youtubeQualityHeight", () => {
  test("extracts height from valid labels", () => {
    expect(youtubeQualityHeight("1080p")).toBe(1080);
    expect(youtubeQualityHeight("720p")).toBe(720);
    expect(youtubeQualityHeight("4K")).toBeUndefined();
    expect(youtubeQualityHeight("best")).toBeUndefined();
    expect(youtubeQualityHeight(undefined)).toBeUndefined();
  });
});

describe("selectYoutubeQuality", () => {
  const entries = [
    { label: "1080p", rank: 1080, formatId: "1080p" },
    { label: "720p", rank: 720, formatId: "720p" },
    { label: "480p", rank: 480, formatId: "480p" },
  ];

  test("returns best for undefined/best", () => {
    expect(selectYoutubeQuality(entries, undefined)).toEqual(entries[0]);
    expect(selectYoutubeQuality(entries, "best")).toEqual(entries[0]);
  });

  test("returns exact match", () => {
    expect(selectYoutubeQuality(entries, "720p")).toEqual(entries[1]);
  });

  test("returns best under ceiling when exact match is missing", () => {
    const skip720 = [
      { label: "1080p", rank: 1080, formatId: "1080p" },
      { label: "480p", rank: 480, formatId: "480p" },
    ];
    expect(selectYoutubeQuality(skip720, "720p")).toEqual(skip720[1]);
  });

  test("returns smallest when all are above ceiling", () => {
    const onlyHigh = [
      { label: "1440p", rank: 1440, formatId: "1440p" },
      { label: "1080p", rank: 1080, formatId: "1080p" },
    ];
    expect(selectYoutubeQuality(onlyHigh, "720p")).toEqual(onlyHigh[1]);
  });
});
