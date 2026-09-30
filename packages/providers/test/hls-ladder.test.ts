import { describe, expect, test } from "bun:test";

import {
  expandHlsMasterInventory,
  isHlsDeadHostStatus,
  looksLikeHlsMasterUrl,
  parseHlsMasterRenditions,
  parseHlsMasterVariants,
  type ExpandHlsMasterPlaylistOptions,
} from "../src/shared/hls-ladder";

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
1080p.m3u8
`;

describe("hls ladder", () => {
  test("parseHlsMasterVariants ranks by resolution descending when sorted by caller", () => {
    const variants = parseHlsMasterVariants(MASTER, "https://cdn.example/master.m3u8");
    expect(variants.map((variant) => variant.qualityLabel)).toEqual(["360p", "720p", "1080p"]);
    expect(variants[2]?.url).toBe("https://cdn.example/1080p.m3u8");
  });

  test("expandHlsMasterInventory fetches and sorts highest quality first", async () => {
    const { variants } = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      fetch: (async () =>
        new Response(MASTER, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        })) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants.map((variant) => variant.qualityLabel)).toEqual(["1080p", "720p", "360p"]);
  });

  test("expandHlsMasterInventory refuses a private master URL without fetching", async () => {
    let called = false;
    const inventory = await expandHlsMasterInventory({
      masterUrl: "http://169.254.169.254/master.m3u8",
      // SAFETY: deliberately partial fetch stub — the test only needs call tracking.
      fetch: (async () => {
        called = true;
        return new Response(MASTER, { status: 200 });
      }) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(called).toBe(false);
    expect(inventory.probe.kind).toBe("blocked-target");
    expect(inventory.variants).toHaveLength(1);
    expect(inventory.variants[0]?.qualityLabel).toBe("auto");
  });

  test("expandHlsMasterInventory refuses a master redirect into a private target", async () => {
    const urls: string[] = [];
    const inventory = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      // SAFETY: deliberately partial fetch stub — the test only needs URL capture.
      fetch: (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:7000/internal.m3u8" },
        });
      }) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(urls).toEqual(["https://cdn.example/master.m3u8"]);
    expect(inventory.probe.kind).toBe("blocked-target");
  });

  test("expandHlsMasterInventory falls back to auto on media playlist", async () => {
    const { variants } = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/index.m3u8",
      fetch: (async () =>
        new Response("#EXTM3U\n#EXTINF:4,\nseg0.ts\n", {
          status: 200,
        })) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants).toEqual([
      {
        url: "https://cdn.example/index.m3u8",
        qualityLabel: "auto",
        qualityRank: 0,
      },
    ]);
  });

  test("expandHlsMasterInventory reports transport failures in probe instead of throwing", async () => {
    // A TLS failure collapsing into an "auto" ladder is how a dead CDN came
    // back attested as a resolved stream (hls.aniwatch.al, 2026-10). The
    // inventory API surfaces the failure in `probe` so callers can gate the
    // fallback row on it instead of trusting a silent auto.
    const inventory = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      fetch: (async () => {
        throw new TypeError("unable to verify the first certificate");
      }) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(inventory.probe).toEqual({ kind: "network" });
    // The corpse row still exists — the probe is what tells callers not to
    // attest it. `network` stays ambiguous on purpose: gatekept CDNs reject
    // expansion fetches yet still play in mpv.
    expect(inventory.variants).toEqual([
      { url: "https://cdn.example/master.m3u8", qualityLabel: "auto", qualityRank: 0 },
    ]);
    expect(isHlsDeadHostStatus(inventory.probe.httpStatus)).toBe(false);
  });

  test("still splits a master whose variants carry their own audio", async () => {
    const muxed = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=661118,CODECS="mp4a.40.2,avc1.42c015",RESOLUTION=640x256
v0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3652287,CODECS="mp4a.40.2,avc1.640028",RESOLUTION=1920x768
v2.m3u8
`;
    const { variants } = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      // SAFETY: stub returns Response like fetch; the option type expects the full fetch signature.
      fetch: (async () => new Response(muxed)) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants.map((variant) => variant.url)).toEqual([
      "https://cdn.example/v2.m3u8",
      "https://cdn.example/v0.m3u8",
    ]);
  });

  test("splits a master whose audio group only labels the audio each variant already has", async () => {
    // A rendition with no URI names audio muxed into every variant (RFC 8216
    // §4.3.4.2.1), so one variant alone still plays with sound.
    const labelledOnly = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="eng",DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=13298235,RESOLUTION=1920x1080,AUDIO="aac"
v-1080/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1764061,RESOLUTION=640x360,AUDIO="aac"
v-360/playlist.m3u8
`;
    const { variants } = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      // SAFETY: stub returns Response like fetch; the option type expects the full fetch signature.
      fetch: (async () => new Response(labelledOnly)) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants.map((variant) => variant.url)).toEqual([
      "https://cdn.example/v-1080/playlist.m3u8",
      "https://cdn.example/v-360/playlist.m3u8",
    ]);
  });

  test("keeps a master whole when the default audio is muxed but another language is not", async () => {
    // Splitting would still play sound, but only the muxed track: the dub the
    // user picked lives in the separate rendition and would be gone.
    const mixedGroup = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Japanese",LANGUAGE="jpn",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="eng",URI="a-eng/playlist.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=13298235,RESOLUTION=1920x1080,AUDIO="aac"
v-1080/playlist.m3u8
`;
    const { variants } = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      // SAFETY: stub returns Response like fetch; the option type expects the full fetch signature.
      fetch: (async () => new Response(mixedGroup)) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants).toEqual([
      { url: "https://cdn.example/master.m3u8", qualityLabel: "auto", qualityRank: 0 },
    ]);
  });

  test("looksLikeHlsMasterUrl detects master leaf names", () => {
    expect(looksLikeHlsMasterUrl("https://cdn.example/master.m3u8")).toBe(true);
    expect(looksLikeHlsMasterUrl("https://cdn.example/vod/index-v1-a1.m3u8")).toBe(false);
  });
});

const MASTER_WITH_MEDIA = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="日本語",LANGUAGE="ja",URI="audio/ja.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Commentary",LANGUAGE="en",URI="audio/commentary.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subs/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",URI="subs/es.m3u8"
#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="CC1",INSTREAM-ID="CC1"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Muxed",LANGUAGE="hi"
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="aud",SUBTITLES="subs"
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080,AUDIO="aud",SUBTITLES="subs"
1080p.m3u8
`;

describe("hls rendition tracks (#EXT-X-MEDIA)", () => {
  test("parses audio and subtitle renditions with resolved URLs", () => {
    const result = parseHlsMasterRenditions(MASTER_WITH_MEDIA, "https://cdn.example/master.m3u8");

    expect(result.audioTracks.map((t) => t.label)).toEqual(["English", "日本語", "Commentary"]);
    expect(result.audioTracks[0]?.url).toBe("https://cdn.example/audio/en.m3u8");
    expect(result.audioTracks[0]?.language).toBe("en");
    expect(result.audioTracks[0]?.isDefault).toBe(true);
    expect(result.audioTracks[1]?.language).toBe("ja");

    expect(result.subtitleTracks.map((t) => t.language)).toEqual(["en", "es"]);
    expect(result.subtitleTracks[1]?.url).toBe("https://cdn.example/subs/es.m3u8");
  });

  test("muxed audio (no URI) still contributes its language to audioLanguages", () => {
    const result = parseHlsMasterRenditions(MASTER_WITH_MEDIA, "https://cdn.example/master.m3u8");
    // hi has no URI — no track — but the language is real and belongs in the inventory.
    expect(result.audioTracks.map((t) => t.language)).toEqual(["en", "ja", "en"]);
    expect(result.audioLanguages).toEqual(["en", "ja", "hi"]);
  });

  test("closed-captions and malformed rows are ignored", () => {
    const text = `${MASTER_WITH_MEDIA}#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Broken"\n`;
    const result = parseHlsMasterRenditions(text, "https://cdn.example/master.m3u8");
    // no CC tracks, and a URI-less SUBTITLES row adds nothing
    expect(result.subtitleTracks).toHaveLength(2);
    expect(result.audioTracks).toHaveLength(3);
  });

  test("expandHlsMasterInventory returns variants plus rendition inventory", async () => {
    const inventory = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/master.m3u8",
      fetch: (async () =>
        new Response(MASTER_WITH_MEDIA, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        })) as ExpandHlsMasterPlaylistOptions["fetch"],
    });

    // MASTER_WITH_MEDIA's variants reference an audio group with URI-addressed
    // renditions, so the ladder keeps the master whole — a lone variant would
    // be video-only. The rendition inventory still parses.
    expect(inventory.variants.map((v) => v.qualityLabel)).toEqual(["auto"]);
    expect(inventory.audioTracks).toHaveLength(3);
    expect(inventory.subtitleTracks).toHaveLength(2);
    expect(inventory.audioLanguages).toEqual(["en", "ja", "hi"]);
  });

  test("expandHlsMasterInventory falls back to an empty-track auto row on media playlists", async () => {
    const inventory = await expandHlsMasterInventory({
      masterUrl: "https://cdn.example/index.m3u8",
      fetch: (async () =>
        new Response("#EXTM3U\n#EXTINF:4,\nseg0.ts\n", {
          status: 200,
        })) as ExpandHlsMasterPlaylistOptions["fetch"],
    });

    expect(inventory.variants).toHaveLength(1);
    expect(inventory.variants[0]?.qualityLabel).toBe("auto");
    expect(inventory.audioTracks).toEqual([]);
    expect(inventory.subtitleTracks).toEqual([]);
    expect(inventory.audioLanguages).toEqual([]);
  });

  test("expandHlsMasterInventory reports a dead host's HTTP status in probe", async () => {
    const inventory = await expandHlsMasterInventory({
      masterUrl: "https://dead.example/master.m3u8",
      fetch: (async () =>
        new Response("gone", { status: 503 })) as ExpandHlsMasterPlaylistOptions["fetch"],
    });

    expect(inventory.probe).toEqual({ kind: "http-error", httpStatus: 503 });
    // The fallback row still exists — callers decide whether to keep it.
    expect(inventory.variants[0]?.qualityLabel).toBe("auto");
    expect(isHlsDeadHostStatus(inventory.probe.httpStatus)).toBe(true);
  });

  test("isHlsDeadHostStatus drops 5xx/404/410 but keeps gatekept statuses", () => {
    for (const dead of [500, 502, 503, 404, 410]) {
      expect(isHlsDeadHostStatus(dead)).toBe(true);
    }
    for (const alive of [200, 301, 400, 401, 403, 429]) {
      expect(isHlsDeadHostStatus(alive)).toBe(false);
    }
    expect(isHlsDeadHostStatus(undefined)).toBe(false);
  });
});
