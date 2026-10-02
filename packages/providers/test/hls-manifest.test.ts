import { describe, expect, test } from "bun:test";

import {
  absolutizeHostRootHlsManifest,
  blockedHlsManifestUriReason,
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

  describe("blockedHlsManifestUriReason", () => {
    test("accepts relative segments, public hosts, and inline data init maps", () => {
      const manifest = [
        "#EXTM3U",
        '#EXT-X-MAP:URI="init-v1.mp4"',
        '#EXT-X-MAP:URI="data:video/mp4;base64,AAAA"',
        "#EXTINF:4,",
        "720/seg-1.ts",
        "/mirror/seg-2.ts",
        "https://media.cdn.example/seg-3.ts",
      ].join("\n");
      expect(blockedHlsManifestUriReason(manifest)).toBeNull();
    });

    test("rejects a file:// segment line", () => {
      const manifest = ["#EXTM3U", "#EXTINF:4,", "file:///etc/passwd"].join("\n");
      expect(blockedHlsManifestUriReason(manifest)).toContain("scheme");
    });

    test("rejects a private-literal segment host", () => {
      const manifest = ["#EXTM3U", "#EXTINF:4,", "http://169.254.169.254/latest/meta-data"].join(
        "\n",
      );
      expect(blockedHlsManifestUriReason(manifest)).toContain("169.254.169.254");
    });

    test("rejects a scheme-relative private host", () => {
      const manifest = ["#EXTM3U", "#EXTINF:4,", "//127.0.0.1/seg.ts"].join("\n");
      expect(blockedHlsManifestUriReason(manifest)).toContain("127.0.0.1");
    });

    test("rejects a non-http key URI attribute", () => {
      const manifest = [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="file:///etc/kunai-data.sqlite"',
        "#EXTINF:4,",
        "seg-1.ts",
      ].join("\n");
      expect(blockedHlsManifestUriReason(manifest)).toContain("scheme file:");
    });

    test("rejects a private-literal URI attribute on a media tag", () => {
      const manifest = [
        "#EXTM3U",
        '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://10.0.0.5/audio.m3u8",GROUP-ID="a"',
      ].join("\n");
      expect(blockedHlsManifestUriReason(manifest)).toContain("10.0.0.5");
    });
  });
});
