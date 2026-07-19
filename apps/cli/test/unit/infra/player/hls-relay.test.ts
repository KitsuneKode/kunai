import { describe, expect, test } from "bun:test";

import {
  fromB64Url,
  rewriteHlsPlaylistForRelay,
  streamNeedsHlsRelay,
  toB64Url,
} from "@/infra/player/hls-relay";

const RELAY = "http://127.0.0.1:9";
const BASE = "https://vault-06.uwucdn.top/path/to/index.m3u8?token=abc%2B%2F%3D";

describe("hls-relay gating", () => {
  test("streamNeedsHlsRelay matches only uwucdn/owocdn hosts", () => {
    expect(streamNeedsHlsRelay("https://vault-06.uwucdn.top/x/index.m3u8")).toBe(true);
    expect(streamNeedsHlsRelay("https://vault-15.owocdn.top/x/index.m3u8")).toBe(true);
    expect(
      streamNeedsHlsRelay("https://fast.speedzy.net/v3-hls-playback/abc/1080/index.m3u8"),
    ).toBe(false);
    expect(streamNeedsHlsRelay("https://bold-cdn.noahwilliams911.workers.dev/video.m3u8")).toBe(
      false,
    );
    expect(streamNeedsHlsRelay("not-a-url")).toBe(false);
  });
});

describe("hls-relay base64url", () => {
  test("preserves query strings through encode/decode", () => {
    const url = "https://vault-06.uwucdn.top/path/index.m3u8?token=abc+/=&x=1";
    expect(fromB64Url(toB64Url(Buffer.from(url)))).toBe(url);
  });
});

describe("rewriteHlsPlaylistForRelay", () => {
  test("rewrites absolute, host-root, relative, and URI attributes", () => {
    const input = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x1',
      '#EXT-X-MAP:URI="init.mp4"',
      "#EXTINF:6,",
      "seg001.ts",
      "/root/seg002.ts",
      "https://vault-06.uwucdn.top/abs/seg003.ts?q=1",
      "",
      "# comment stays",
    ].join("\n");

    const out = rewriteHlsPlaylistForRelay(input, BASE, RELAY);
    const lines = out.split("\n");

    expect(lines[0]).toBe("#EXTM3U");
    expect(lines[1]).toContain('URI="http://127.0.0.1:9/s/');
    expect(fromB64Url(lines[1]!.match(/\/s\/([^"]+)/)![1]!)).toBe(
      "https://vault-06.uwucdn.top/path/to/key.key",
    );
    expect(fromB64Url(lines[2]!.match(/\/s\/([^"]+)/)![1]!)).toBe(
      "https://vault-06.uwucdn.top/path/to/init.mp4",
    );
    expect(fromB64Url(lines[4]!.replace(`${RELAY}/s/`, ""))).toBe(
      "https://vault-06.uwucdn.top/path/to/seg001.ts",
    );
    expect(fromB64Url(lines[5]!.replace(`${RELAY}/s/`, ""))).toBe(
      "https://vault-06.uwucdn.top/root/seg002.ts",
    );
    expect(fromB64Url(lines[6]!.replace(`${RELAY}/s/`, ""))).toBe(
      "https://vault-06.uwucdn.top/abs/seg003.ts?q=1",
    );
    expect(lines[8]).toBe("# comment stays");
  });

  test("routes nested playlists through /p/", () => {
    const input = ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=1", "1080/index.m3u8"].join("\n");
    const out = rewriteHlsPlaylistForRelay(input, BASE, RELAY);
    const uriLine = out.split("\n")[2]!;
    expect(uriLine.startsWith(`${RELAY}/p/`)).toBe(true);
    expect(uriLine.endsWith(".m3u8")).toBe(true);
    const b64 = uriLine.slice(`${RELAY}/p/`.length).replace(/\.m3u8$/, "");
    expect(fromB64Url(b64)).toBe("https://vault-06.uwucdn.top/path/to/1080/index.m3u8");
  });

  test("rejects non-allowlisted upstream hosts in playlist URIs", () => {
    const input = ["#EXTM3U", "https://evil.example/seg.ts"].join("\n");
    expect(() => rewriteHlsPlaylistForRelay(input, BASE, RELAY)).toThrow(/not allowlisted/);
  });
});
