import { describe, expect, test } from "bun:test";

import {
  absolutizeHlsManifest,
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
    const output = absolutizeHlsManifest(
      ["#EXTM3U", "#EXTINF:3,", "/foo/bar/seg.jpg"].join("\n"),
      "https://light.goldweather.net/token/index.m3u8",
    );
    expect(output).toContain("https://light.goldweather.net/foo/bar/seg.jpg");
  });

  test("absolutizes relative segments and every URI attribute against the served URL", () => {
    const output = absolutizeHlsManifest(
      [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
        '#EXT-X-MAP:URI="/init/init.mp4"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="ja",URI="audio/ja.m3u8"',
        "#EXTINF:4,",
        "seg-1.m4s",
        "#EXTINF:4,",
        "/abs/seg-2.m4s",
        "#EXTINF:4,",
        "https://other.example/seg-3.m4s",
      ].join("\n"),
      "https://cdn.example/hls/ep1/index.m3u8",
    );
    expect(output).toContain('URI="https://cdn.example/hls/ep1/key.bin",IV=0x1');
    expect(output).toContain('#EXT-X-MAP:URI="https://cdn.example/init/init.mp4"');
    expect(output).toContain('URI="https://cdn.example/hls/ep1/audio/ja.m3u8"');
    expect(output).toContain("\nhttps://cdn.example/hls/ep1/seg-1.m4s\n");
    expect(output).toContain("\nhttps://cdn.example/abs/seg-2.m4s\n");
    expect(output).toContain("\nhttps://other.example/seg-3.m4s");
    // Tags without a URI pass through untouched.
    expect(output).toContain("#EXTINF:4,");
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

  test("parses the variant URI after STREAM-INF even when the playlist extension is obfuscated", () => {
    const master = [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio.m3u8.png?exp=1"',
      '#EXT-X-STREAM-INF:BANDWIDTH=24000000,RESOLUTION=3840x1600,AUDIO="audio"',
      "video_2160p.m3u8.png?exp=1&sig=abc",
    ].join("\n");
    expect(isHlsMasterPlaylist(master)).toBe(true);
    expect(parseFirstHlsVariantPath(master)).toBe("video_2160p.m3u8.png?exp=1&sig=abc");
  });

  test("skips ordinary comments after STREAM-INF without crossing a stream boundary", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080",
      "# packager comment before the video URI",
      "video/v1.m3u8.png",
      "#EXT-X-STREAM-INF:BANDWIDTH=128000",
      "# comment inside the audio-only entry",
      "audio/a1.m3u8.png",
    ].join("\n");
    expect(parseFirstHlsVariantPath(master)).toBe("video/v1.m3u8.png");

    const boundaryOnly = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=4000000",
      "#EXT-X-STREAM-INF:BANDWIDTH=128000",
      "audio/a1.m3u8.png",
    ].join("\n");
    expect(parseFirstHlsVariantPath(boundaryOnly)).toBe("audio/a1.m3u8.png");
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

describe("parseFirstHlsVariantPath variant preference", () => {
  test("an audio-only STREAM-INF ahead of the video variant does not win", () => {
    const master = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"',
      "index-a1.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      "index-v1.m3u8",
    ].join("\n");
    expect(parseFirstHlsVariantPath(master)).toBe("index-v1.m3u8");
  });

  test("without RESOLUTION it falls back to the filename heuristic over STREAM-INF entries", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=128000",
      "audio/a1.m3u8.png",
      "#EXT-X-STREAM-INF:BANDWIDTH=4000000",
      "video/v1.m3u8.png",
    ].join("\n");
    expect(parseFirstHlsVariantPath(master)).toBe("video/v1.m3u8.png");
  });
});
