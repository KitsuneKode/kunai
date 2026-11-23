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

  test("parser edge cases: AV1/AVC Dolby Vision, supplemental codecs, casing, quoting", () => {
    const inf = (attrs: string) => `#EXT-X-STREAM-INF:BANDWIDTH=9000000,${attrs}`;
    expect(detectHlsVariantDynamicRange(inf('CODECS="dav1.10.09,opus"'))).toBe("dolby-vision");
    expect(detectHlsVariantDynamicRange(inf('CODECS="dva1.09.05,mp4a.40.2"'))).toBe("dolby-vision");
    // Profile 8.1 signalled only as a supplemental codec plays as its HDR10 base.
    expect(
      detectHlsVariantDynamicRange(
        inf('CODECS="hvc1.2.4.L153.B0",SUPPLEMENTAL-CODECS="dvh1.08.06/db1p",VIDEO-RANGE=PQ'),
      ),
    ).toBe("hdr10");
    expect(detectHlsVariantDynamicRange(inf("video-range=hlg"))).toBe("hlg");
    expect(detectHlsVariantDynamicRange(inf("CODECS=dvh1.05.06"))).toBe("dolby-vision");
    expect(detectHlsVariantDynamicRange(inf("RESOLUTION=1920x1080"))).toBeUndefined();

    // I-frame playlists are not variants; a variant without RESOLUTION adds no height.
    const master = [
      "#EXTM3U",
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=200000,RESOLUTION=3840x2160,VIDEO-RANGE=PQ,URI="iframe.m3u8"',
      "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,VIDEO-RANGE=SDR",
      "1080.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=6000000,VIDEO-RANGE=SDR",
      "unknown.m3u8",
    ].join("\n");
    expect(parseHlsMasterMaxHeight(master)).toBe(1080);
    expect(detectHlsMasterDynamicRange(master)).toBe("sdr");
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
