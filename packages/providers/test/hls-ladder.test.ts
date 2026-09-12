import { describe, expect, test } from "bun:test";

import {
  expandHlsMasterPlaylist,
  looksLikeHlsMasterUrl,
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

  test("keeps a master whole when its variants take audio from a rendition group", async () => {
    // Those variant playlists are video-only; handing mpv one would play
    // silent video. The quality picker is what gets lost, not the sound.
    const withAudioGroup = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English",LANGUAGE="eng",URI="a-eng/playlist.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=13298235,RESOLUTION=1920x1080,AUDIO="stereo"
v-1080/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1764061,RESOLUTION=640x360,AUDIO="stereo"
v-360/playlist.m3u8
`;
    const variants = await expandHlsMasterPlaylist({
      masterUrl: "https://cdn.example/master.m3u8",
      fetch: (async () => new Response(withAudioGroup)) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants).toEqual([
      { url: "https://cdn.example/master.m3u8", qualityLabel: "auto", qualityRank: 0 },
    ]);
  });

  test("still splits a master whose variants carry their own audio", async () => {
    const muxed = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=661118,CODECS="mp4a.40.2,avc1.42c015",RESOLUTION=640x256
v0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3652287,CODECS="mp4a.40.2,avc1.640028",RESOLUTION=1920x768
v2.m3u8
`;
    const variants = await expandHlsMasterPlaylist({
      masterUrl: "https://cdn.example/master.m3u8",
      fetch: (async () => new Response(muxed)) as ExpandHlsMasterPlaylistOptions["fetch"],
    });
    expect(variants.map((variant) => variant.url)).toEqual([
      "https://cdn.example/v2.m3u8",
      "https://cdn.example/v0.m3u8",
    ]);
  });

  test("looksLikeHlsMasterUrl detects master leaf names", () => {
    expect(looksLikeHlsMasterUrl("https://cdn.example/master.m3u8")).toBe(true);
    expect(looksLikeHlsMasterUrl("https://cdn.example/vod/index-v1-a1.m3u8")).toBe(false);
  });
});
