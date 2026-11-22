import { describe, expect, test } from "bun:test";

import {
  detectHlsMasterDynamicRange,
  detectHlsVariantDynamicRange,
  parseHlsMasterMaxHeight,
  parseHlsMasterVariants,
} from "../src/shared/hls-ladder";
import { detectDynamicRangeFromLabel } from "../src/shared/source-inventory";

describe("HLS HDR / Dolby Vision detection and master max-height parsing", () => {
  test("detects Dolby Vision, HDR10 (PQ), HLG, and SDR from HLS STREAM-INF lines", () => {
    expect(
      detectHlsVariantDynamicRange(
        '#EXT-X-STREAM-INF:BANDWIDTH=18000000,RESOLUTION=3840x2160,CODECS="dvh1.05.06,mp4a.40.2",VIDEO-RANGE=PQ',
      ),
    ).toBe("dolby-vision");
    expect(
      detectHlsVariantDynamicRange(
        '#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160,CODECS="hev1.2.4.L150.B0",VIDEO-RANGE=PQ',
      ),
    ).toBe("hdr10");
    expect(
      detectHlsVariantDynamicRange(
        "#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160,VIDEO-RANGE=HLG",
      ),
    ).toBe("hlg");
    expect(
      detectHlsVariantDynamicRange(
        "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,VIDEO-RANGE=SDR",
      ),
    ).toBe("sdr");
  });

  test("parseHlsMasterVariants carries dynamicRange and parseHlsMasterMaxHeight reads top rung", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=18000000,RESOLUTION=3840x2160,VIDEO-RANGE=PQ",
      "4k-hdr.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,VIDEO-RANGE=SDR",
      "1080-sdr.m3u8",
    ].join("\n");

    const variants = parseHlsMasterVariants(master, "https://cdn.example.test/master.m3u8");
    expect(variants).toHaveLength(2);
    expect(variants[0]?.qualityLabel).toBe("2160p");
    expect(variants[0]?.dynamicRange).toBe("hdr10");
    expect(variants[1]?.qualityLabel).toBe("1080p");
    expect(variants[1]?.dynamicRange).toBe("sdr");

    expect(parseHlsMasterMaxHeight(master)).toBe(2160);
    expect(detectHlsMasterDynamicRange(master)).toBe("hdr10");
  });

  test("detectDynamicRangeFromLabel classifies release/quality tokens cleanly", () => {
    expect(detectDynamicRangeFromLabel("2160p Dolby Vision")).toBe("dolby-vision");
    expect(detectDynamicRangeFromLabel("4K DV")).toBe("dolby-vision");
    expect(detectDynamicRangeFromLabel("2160p HDR10+")).toBe("hdr10");
    expect(detectDynamicRangeFromLabel("1080p HLG")).toBe("hlg");
    expect(detectDynamicRangeFromLabel("1080p SDR")).toBe("sdr");
    expect(detectDynamicRangeFromLabel("1080p")).toBeUndefined();
  });
});
