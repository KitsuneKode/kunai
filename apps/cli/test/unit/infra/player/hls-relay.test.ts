import { describe, expect, test } from "bun:test";

import {
  fromB64Url,
  looksLikeHlsPlaylist,
  rewriteHlsPlaylistForRelay,
  streamNeedsHlsRelay,
  toB64Url,
} from "@/infra/player/hls-relay";
import { normalizeStreamHttpHeaders } from "@/infra/player/mpv-stream-http-headers";

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

  /**
   * The allowlist is the only gate on what the relay will fetch, and it is
   * applied to attacker-influenceable input: base64 path segments on `/p/` and
   * `/s/`, and every URI rewritten out of a provider-supplied playlist.
   *
   * The patterns were unanchored substring tests (`/\.uwucdn\./i`), so any host
   * containing `.uwucdn.` as a label matched — an attacker-controlled domain
   * turned the local relay into a fetcher for arbitrary external hosts.
   */
  test("the CDN allowlist is a domain suffix, not a substring", () => {
    // Attacker-registrable domains that contain the allowlisted label.
    expect(streamNeedsHlsRelay("https://evil.uwucdn.attacker.com/x.m3u8")).toBe(false);
    expect(streamNeedsHlsRelay("https://uwucdn.evil.com/x.m3u8")).toBe(false);
    expect(streamNeedsHlsRelay("https://owocdn.top.evil.net/x.m3u8")).toBe(false);
    expect(streamNeedsHlsRelay("https://not-uwucdn.top.attacker.io/x.m3u8")).toBe(false);

    // The real hosts still pass, on any TLD and at any subdomain depth.
    expect(streamNeedsHlsRelay("https://uwucdn.top/x.m3u8")).toBe(true);
    expect(streamNeedsHlsRelay("https://vault-06.uwucdn.top/x.m3u8")).toBe(true);
    expect(streamNeedsHlsRelay("https://a.b.c.owocdn.top/x.m3u8")).toBe(true);
  });

  test("a hostless URL never matches", () => {
    // `streamNeedsHlsRelay` answers "should this stream go through the relay",
    // which is a host question — the scheme is enforced later and separately by
    // `assertRelayUpstreamUrl`, which every fetch goes through and which
    // rejects anything that is not http(s). Pinning the host contract here so
    // the split stays deliberate rather than looking like a gap.
    expect(streamNeedsHlsRelay("file:///etc/passwd")).toBe(false);
    expect(streamNeedsHlsRelay("")).toBe(false);
  });
});

/**
 * Both handlers used to identify a playlist with
 * `body.toString("utf-8").startsWith("#EXTM3U")` — decoding the entire
 * response to test seven bytes. On a binary MPEG-TS segment that is the worst
 * case: the bytes are not valid UTF-8, so V8 builds a two-byte string and runs
 * replacement-character substitution over several megabytes, per segment.
 *
 * The byte comparison must answer identically for every case the string form
 * did, which is what these pin.
 */
describe("hls-relay playlist detection on bytes", () => {
  const utf8Says = (body: Buffer) => body.toString("utf-8").startsWith("#EXTM3U");

  test("agrees with the old string check on playlists", () => {
    for (const text of [
      "#EXTM3U\n#EXT-X-VERSION:3\n",
      "#EXTM3U",
      "#EXTM3U\n",
      "#EXTM3U\n#EXTINF:9.009,\nseg.ts\n",
    ]) {
      const body = Buffer.from(text, "utf-8");
      expect(looksLikeHlsPlaylist(body)).toBe(true);
      expect(looksLikeHlsPlaylist(body)).toBe(utf8Says(body));
    }
  });

  test("agrees with the old string check on non-playlists", () => {
    for (const text of ["#EXTM3", "", "EXTM3U", " #EXTM3U", "#EXT-X-VERSION:3"]) {
      const body = Buffer.from(text, "utf-8");
      expect(looksLikeHlsPlaylist(body)).toBe(false);
      expect(looksLikeHlsPlaylist(body)).toBe(utf8Says(body));
    }
  });

  test("a binary segment is not a playlist, and is never decoded to find out", () => {
    // MPEG-TS: 0x47 sync byte, then bytes that are invalid UTF-8 sequences.
    const segment = Buffer.from([0x47, 0x40, 0x11, 0x10, 0xff, 0xfe, 0x80, 0x81, 0x00, 0xc0]);
    expect(looksLikeHlsPlaylist(segment)).toBe(false);
    expect(looksLikeHlsPlaylist(segment)).toBe(utf8Says(segment));
  });

  test("a body shorter than the magic does not over-read", () => {
    expect(looksLikeHlsPlaylist(Buffer.alloc(0))).toBe(false);
    expect(looksLikeHlsPlaylist(Buffer.from([0x23]))).toBe(false);
    expect(looksLikeHlsPlaylist(Buffer.from("#EXTM3", "latin1"))).toBe(false);
  });
});

describe("hls-relay header hygiene", () => {
  test("provider headers pass through the mpv-path sanitizer before reaching curl argv", () => {
    // startHlsRelay feeds referer/origin into `curl -H`; values go through the
    // same normalization as the mpv path (case-insensitive lookup, CR/LF
    // stripped) so a hostile value can never split into extra header lines.
    const normalized = normalizeStreamHttpHeaders({
      referer: "https://kwik.cx/\r\nX-Smuggled: 1",
      Origin: "https://kwik.cx\r\nEvil: 1",
      "User-Agent": "ua\r\nInjected: 1",
    });
    expect(normalized.referer).toBe("https://kwik.cx/X-Smuggled: 1");
    expect(normalized.origin).toBe("https://kwik.cxEvil: 1");
    expect(normalized.userAgent).toBe("uaInjected: 1");
    expect(JSON.stringify(normalized)).not.toContain("\n");
    expect(JSON.stringify(normalized)).not.toContain("\r");
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
