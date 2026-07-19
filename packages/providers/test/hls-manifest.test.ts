import { describe, expect, test } from "bun:test";

import {
  absolutizeHostRootHlsManifest,
  isHlsMasterPlaylist,
  manifestUsesHostRootSegmentPaths,
  parseFirstHlsMediaSegmentPath,
  parseFirstHlsVariantPath,
  resolveHlsSegmentUrl,
  shouldMaterializeHlsManifest,
} from "../src/shared/hls-manifest";

describe("hls-manifest helpers", () => {
  test("detects host-root segment paths", () => {
    expect(
      manifestUsesHostRootSegmentPaths(
        ["#EXTM3U", "#EXTINF:3,", "/segment-a/seg-1.jpg", "#EXTINF:3,", "relative/seg.ts"].join(
          "\n",
        ),
      ),
    ).toBe(true);
    expect(
      manifestUsesHostRootSegmentPaths(["#EXTM3U", "#EXTINF:3,", "relative/seg.ts"].join("\n")),
    ).toBe(false);
  });

  test("absolutizes host-root paths against manifest origin", () => {
    const output = absolutizeHostRootHlsManifest(
      ["#EXTM3U", "#EXTINF:3,", "/foo/bar/seg.jpg"].join("\n"),
      "https://light.goldweather.net/token/index.m3u8",
    );
    expect(output).toContain("https://light.goldweather.net/foo/bar/seg.jpg");
  });

  test("resolves first media segment and host-root URLs", () => {
    const manifest = ["#EXTM3U", "#EXTINF:3,", "/mirror/seg-1.jpg"].join("\n");
    expect(parseFirstHlsMediaSegmentPath(manifest)).toBe("/mirror/seg-1.jpg");
    expect(
      resolveHlsSegmentUrl("https://light.goldweather.net/token/index.m3u8", "/mirror/seg-1.jpg"),
    ).toBe("https://light.goldweather.net/mirror/seg-1.jpg");
  });

  test("skips nested playlist URIs when parsing media segments", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1000000",
      "index-v1-a1.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=500000",
      "index-v2-a1.m3u8",
    ].join("\n");
    expect(isHlsMasterPlaylist(master)).toBe(true);
    expect(parseFirstHlsMediaSegmentPath(master)).toBeNull();
    expect(parseFirstHlsVariantPath(master)).toBe("index-v1-a1.m3u8");
  });

  test("parses obfuscated media segment names", () => {
    const media = ["#EXTM3U", "#EXTINF:4,", "seg-1-v1-a1.ts.html"].join("\n");
    expect(isHlsMasterPlaylist(media)).toBe(false);
    expect(parseFirstHlsMediaSegmentPath(media)).toBe("seg-1-v1-a1.ts.html");
  });

  test("materializes when host-root and large or known CDN", () => {
    const smallHostRoot = ["#EXTM3U", "#EXTINF:3,", "/seg.jpg"].join("\n");
    expect(
      shouldMaterializeHlsManifest("https://light.goldweather.net/token/index.m3u8", smallHostRoot),
    ).toBe(true);
    expect(shouldMaterializeHlsManifest("https://cdn.example/master.m3u8", smallHostRoot)).toBe(
      false,
    );

    const relativeOnly = ["#EXTM3U", "#EXTINF:3,", "720/seg.ts"].join("\n");
    expect(
      shouldMaterializeHlsManifest("https://light.goldweather.net/token/index.m3u8", relativeOnly),
    ).toBe(false);
  });
});
