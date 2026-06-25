import { describe, expect, test } from "bun:test";

import {
  estimateBytesForDownloadQuality,
  parseQualityHeight,
  resolveDownloadQualityCeiling,
  streamMeetsDownloadQualityFloor,
  ytDlpFormatSelectorForQuality,
} from "@/services/download/download-quality-policy";

describe("download-quality-policy", () => {
  test("parseQualityHeight reads explicit p suffix heights", () => {
    expect(parseQualityHeight("1080p")).toBe(1080);
    expect(parseQualityHeight("best")).toBeNull();
  });

  test("resolveDownloadQualityCeiling picks the highest explicit tier", () => {
    expect(resolveDownloadQualityCeiling("720p", "1080p", "480p")).toBe("1080p");
    expect(resolveDownloadQualityCeiling("best", "1080p")).toBe("1080p");
  });

  test("streamMeetsDownloadQualityFloor rejects streams below the configured ceiling", () => {
    expect(streamMeetsDownloadQualityFloor({ qualityLabel: "360p" }, "1080p")).toBe(false);
    expect(streamMeetsDownloadQualityFloor({ qualityRank: 1080 }, "720p")).toBe(true);
  });

  test("ytDlpFormatSelectorForQuality prefers DASH merge for height caps", () => {
    expect(ytDlpFormatSelectorForQuality("1080p")).toBe(
      "bestvideo[height<=1080]+bestaudio/bestvideo[height<=1080]/bestvideo+bestaudio/bv*+ba/b",
    );
    expect(ytDlpFormatSelectorForQuality("best")).toBeUndefined();
  });

  test("estimateBytesForDownloadQuality scales with configured tier", () => {
    expect(estimateBytesForDownloadQuality("1080p")).toBeGreaterThan(
      estimateBytesForDownloadQuality("480p"),
    );
  });
});
