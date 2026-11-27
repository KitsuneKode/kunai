import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { filesunProviderModule } from "../src/filesun/direct";
import tvLookup from "./fixtures/filesun/lookup-tv.json";

const TV_INPUT: ProviderResolveInput = {
  title: { id: "tmdb:1399", kind: "series", title: "Game of Thrones", year: 2011, tmdbId: "1399" },
  // The intake verified S02E03; absoluteEpisode must not leak into the lookup.
  episode: { season: 2, episode: 3, absoluteEpisode: 17 },
  mediaKind: "series",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

const MASTER_URL = "https://prx-1317-ant.vmpx.online/hls2/got/master.m3u8";

// The recorded page shape: JW Player setup whose first sources entry is the
// FileSuN HLS master; the second is a placeholder on a host this adapter must
// never ship. baseTracks carries the verified Romanian caption plus a
// thumbnails row that is not a subtitle lane.
const EMBED_HTML = `<html><script>
  jwplayer("player").setup({
    sources: [{file: '${MASTER_URL}', type: 'hls'}, {file: 'https://bogus.invalid/ph/player.m3u8'}],
    image: 'https://img.embedsun.cc/thumbs/got.jpg'
  });
  var baseTracks = [
    {file: 'https://srt.vidmoly.me/subs/got/s02e03/ro.vtt', label: 'Romanian', kind: 'captions'},
    {file: 'https://img.embedsun.cc/thumbs/got-s02e03.vtt', kind: 'thumbnails'}
  ];
</script></html>`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360/index.m3u8
`;

const MEDIA_PLAYLIST = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg-1.ts\n";
const SEGMENT_BYTES = new Uint8Array(2048);

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function contextReturning(handler: Handler, requests?: string[]): ProviderRuntimeContext {
  return {
    providerId: "filesun",
    now: () => "2026-11-27T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : url.toString();
        requests?.push(href);
        return handler(href, init) ?? new Response("fixture miss", { status: 404 });
      },
    },
  };
}

const referers: string[] = [];

function healthyHandler(url: string, init?: RequestInit): Response | undefined {
  if (url.startsWith("https://pal.hls.lol/fs/embed")) {
    return Response.json(tvLookup);
  }
  if (url === "https://embedsun.cc/embed-f2a1c9d4.html") {
    return new Response(EMBED_HTML, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url === MASTER_URL) {
    referers.push(new Headers(init?.headers).get("referer") ?? "");
    return new Response(MASTER, {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  }
  if (url.endsWith("/720/index.m3u8") || url.endsWith("/360/index.m3u8")) {
    referers.push(new Headers(init?.headers).get("referer") ?? "");
    return new Response(MEDIA_PLAYLIST, {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  }
  if (url.endsWith("/seg-1.ts")) {
    referers.push(new Headers(init?.headers).get("referer") ?? "");
    return new Response(SEGMENT_BYTES, {
      status: 206,
      headers: { "content-type": "video/mp2t", "content-range": "bytes 0-65535/2048" },
    });
  }
  return undefined;
}

describe("FileSuN direct resolver", () => {
  test("addresses TV by season/episode, not absoluteEpisode", async () => {
    const requests: string[] = [];
    await filesunProviderModule.resolve(TV_INPUT, contextReturning(healthyHandler, requests));

    const lookup = new URL(requests[0] ?? "");
    expect(lookup.origin + lookup.pathname).toBe("https://pal.hls.lol/fs/embed");
    expect(lookup.searchParams.get("type")).toBe("tv");
    expect(lookup.searchParams.get("seasonId")).toBe("2");
    expect(lookup.searchParams.get("episodeId")).toBe("3");
    expect(lookup.searchParams.get("episodeId")).not.toBe("17");
  });

  test("resolves the FileSuN embed into verified variant streams and the caption lane only", async () => {
    referers.length = 0;
    const requests: string[] = [];
    const result = await filesunProviderModule.resolve(
      TV_INPUT,
      contextReturning(healthyHandler, requests),
    );

    expect(result.status).toBe("resolved");
    expect(result.streamReachabilityVerified).toBe(true);
    expect(result.streams.map((stream) => stream.qualityLabel)).toEqual(["720p", "360p"]);
    expect(result.streams.every((stream) => stream.serverName === "FileSuN")).toBe(true);
    // No phantom server rows: VOE/Doodstream and the bogus placeholder stay out.
    expect(result.sources?.map((source) => source.label)).toEqual(["FileSuN"]);
    expect(requests.some((url) => url.includes("bogus.invalid"))).toBe(false);
    expect(requests.some((url) => url.includes("voe.example"))).toBe(false);
    expect(result.subtitles.map((subtitle) => [subtitle.url, subtitle.language])).toEqual([
      ["https://srt.vidmoly.me/subs/got/s02e03/ro.vtt", "ro"],
    ]);
    expect(result.subtitles[0]?.label).toBe("Romanian");
    // Every media probe carried the embed-origin Referer the playback will use.
    expect(referers.length).toBeGreaterThan(0);
    expect(referers.every((referer) => referer === "https://embedsun.cc/")).toBe(true);
  });

  test("a refused media segment fails the strict gate and ships no streams", async () => {
    const result = await filesunProviderModule.resolve(
      TV_INPUT,
      contextReturning((url, init) => {
        if (url.endsWith("/seg-1.ts")) {
          return new Response("forbidden", { status: 403 });
        }
        return healthyHandler(url, init);
      }),
    );

    expect(result.status).not.toBe("resolved");
    expect(result.streams).toEqual([]);
  });

  test("a non-allowed embed host and a missing episode stop before any follow request", async () => {
    const foreignLookup = {
      ...tvLookup,
      embeds: [{ name: "FileSuN", url: "https://evil.example/embed-f2a1c9d4.html" }],
    };
    const foreignRequests: string[] = [];
    const foreign = await filesunProviderModule.resolve(
      TV_INPUT,
      contextReturning((url) => {
        if (url.startsWith("https://pal.hls.lol/fs/embed")) return Response.json(foreignLookup);
        return undefined;
      }, foreignRequests),
    );
    expect(foreign.status).not.toBe("resolved");
    expect(foreignRequests).toHaveLength(1);

    const noEpisodeRequests: string[] = [];
    const noEpisode = await filesunProviderModule.resolve(
      { ...TV_INPUT, episode: undefined },
      contextReturning(healthyHandler, noEpisodeRequests),
    );
    expect(noEpisode.status).not.toBe("resolved");
    expect(noEpisodeRequests).toHaveLength(0);
  });

  test("a title without a year returns no result and makes no requests", async () => {
    const requests: string[] = [];
    const result = await filesunProviderModule.resolve(
      { ...TV_INPUT, title: { ...TV_INPUT.title, year: undefined } },
      contextReturning(healthyHandler, requests),
    );

    expect(result.status).not.toBe("resolved");
    expect(requests).toHaveLength(0);
  });
});
