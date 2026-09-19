import { describe, expect, test } from "bun:test";

import {
  expandHlsMasterInventory,
  expandHlsMasterPlaylist,
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

  test("expandHlsMasterPlaylist fetches and sorts highest quality first", async () => {
    const variants = await expandHlsMasterPlaylist({
      masterUrl: "https://cdn.example/master.m3u8",
      fetch: (async () =>
        new Response(MASTER, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        })) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants.map((variant) => variant.qualityLabel)).toEqual(["1080p", "720p", "360p"]);
  });

  test("expandHlsMasterPlaylist falls back to auto on media playlist", async () => {
    const variants = await expandHlsMasterPlaylist({
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

    expect(inventory.variants.map((v) => v.qualityLabel)).toEqual(["1080p", "720p"]);
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
});
