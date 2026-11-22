import { describe, expect, test } from "bun:test";

import { selectYoutubeQuality, youtubeQualityHeight } from "../../src/youtube/quality-selection";

describe("youtubeQualityHeight", () => {
  test("extracts height from valid labels", () => {
    expect(youtubeQualityHeight("1080p")).toBe(1080);
    expect(youtubeQualityHeight("720p")).toBe(720);
    expect(youtubeQualityHeight("4K")).toBe(2160);
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

  test("prefers a video-only rendition over a muxed one at the same rank when audio language is explicit", () => {
    const entries = [
      { label: "720p · H.264 · HLS · #95", rank: 720, formatId: "95", hasAudio: true },
      { label: "720p · VP9 · #247", rank: 720, formatId: "247", hasAudio: false },
      { label: "480p · H.264 · #94", rank: 480, formatId: "94", hasAudio: true },
    ];
    expect(selectYoutubeQuality(entries, "720p")?.formatId).toBe("95");
    expect(selectYoutubeQuality(entries, "720p", { preferSeparateAudio: true })?.formatId).toBe(
      "247",
    );
    expect(selectYoutubeQuality(entries, "best", { preferSeparateAudio: true })?.formatId).toBe(
      "247",
    );
    // Never trades resolution for a separate audio track.
    expect(selectYoutubeQuality(entries, "480p", { preferSeparateAudio: true })?.formatId).toBe(
      "94",
    );
    // An exact label is the viewer's explicit pick and is honored as-is.
    expect(
      selectYoutubeQuality(entries, "720p · H.264 · HLS · #95", { preferSeparateAudio: true })
        ?.formatId,
    ).toBe("95");
  });
});
