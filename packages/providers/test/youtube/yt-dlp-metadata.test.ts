import { describe, expect, test } from "bun:test";

import {
  buildYtdlFormatSelector,
  mapYtDlpFormatsToQualityLabels,
} from "../../src/youtube/yt-dlp-metadata";

describe("buildYtdlFormatSelector", () => {
  test("returns default format for undefined, best, auto", () => {
    const def = "bestvideo+bestaudio/best";
    expect(buildYtdlFormatSelector(undefined)).toBe(def);
    expect(buildYtdlFormatSelector("best")).toBe(def);
    expect(buildYtdlFormatSelector("auto")).toBe(def);
    expect(buildYtdlFormatSelector("")).toBe(def);
  });

  test("builds height ceiling with DASH merge for numeric qualities", () => {
    expect(buildYtdlFormatSelector("1080p")).toBe(
      "bestvideo[height<=?1080]+bestaudio/bestvideo+bestaudio/best",
    );
    expect(buildYtdlFormatSelector("1440p")).toBe(
      "bestvideo[height<=?1440]+bestaudio/bestvideo+bestaudio/best",
    );
    expect(buildYtdlFormatSelector("4K")).toBe("bestvideo+bestaudio/best"); // Doesn't match regex
  });
});

describe("mapYtDlpFormatsToQualityLabels", () => {
  test("maps valid video formats to unique ranked qualities", () => {
    const formats = [
      { format_id: "1", height: 1080, vcodec: "avc1" },
      { format_id: "2", height: 720, vcodec: "vp9" },
      { format_id: "3", height: 1080, vcodec: "vp9" }, // Duplicate height
      { format_id: "4", height: 0, vcodec: "avc1" }, // Invalid height
      { format_id: "5", height: 480, vcodec: "none" }, // Audio only
    ];

    const mapped = mapYtDlpFormatsToQualityLabels(formats);

    expect(mapped).toEqual([
      { label: "1080p", rank: 1080, formatId: "1" },
      { label: "720p", rank: 720, formatId: "2" },
    ]);
  });
});
