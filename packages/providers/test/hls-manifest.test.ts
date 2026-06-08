import { describe, expect, test } from "bun:test";

import {
  absolutizeHostRootHlsManifest,
  manifestUsesHostRootSegmentPaths,
  parseFirstHlsMediaSegmentPath,
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
