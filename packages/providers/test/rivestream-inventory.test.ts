import { beforeEach, expect, test } from "bun:test";

import type { LooseJsonValue, ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import {
  clearRivestreamCachesForTest,
  parseRivestreamProxyHeaders,
  unwrapRivestreamProxyUrl,
  rivestreamProviderModule,
} from "../src/rivestream/direct";

const INPUT: ProviderResolveInput = {
  title: { id: "tmdb:550", tmdbId: "550", title: "Fight Club", kind: "movie" },
  mediaKind: "movie",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};
const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="en.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="aud",SUBTITLES="subs"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="aud",SUBTITLES="subs"
720.m3u8
`;
const wrapper = (host: string, headers: LooseJsonValue) =>
  `https://${host}/m3u8?url=${encodeURIComponent("https://cdn.example/master.m3u8")}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
beforeEach(() => clearRivestreamCachesForTest());

test("untrusted hosts cannot supply playback headers through query parameters", () => {
  expect(
    parseRivestreamProxyHeaders(
      wrapper("proxy.valhallastream.com.evil.example", { Referer: "https://trusted.example/" }),
    ),
  ).toBeNull();
});
test("known wrapper headers reject controls and transport overrides", () => {
  expect(
    parseRivestreamProxyHeaders(
      wrapper("proxy.valhallastream.com", {
        Referer: "https://www.rivestream.app/",
        Host: "localhost",
        Connection: "close",
        Cookie: "secret",
        "X-Bad\r\n": "x",
        Origin: "https://ok.example/\r\nX: injected",
        "User-Agent": "browser",
      }),
    ),
  ).toEqual({ referer: "https://www.rivestream.app/", "user-agent": "browser" });
});

test("the live corsflix wrapper yields its direct media target and playback headers", () => {
  const target =
    "https://norway-canary.bigbang.cymru/origin_movie/movies/tmdb-27205-Inception-2010-v2/index.m3u8.png?exp=1795905000&sig=abc";
  const wrapped = `https://cors.corsflix.net/m3u8?url=${encodeURIComponent(target)}&headers=${encodeURIComponent(
    JSON.stringify({
      Referer: "https://vidrift.in/",
      Origin: "https://vidrift.in",
      "User-Agent": "Mozilla/5.0",
    }),
  )}`;
  expect(parseRivestreamProxyHeaders(wrapped)).toEqual({
    referer: "https://vidrift.in/",
    origin: "https://vidrift.in",
    "user-agent": "Mozilla/5.0",
  });
  expect(unwrapRivestreamProxyUrl(wrapped)).toBe(target);
});

test("corsflix targets that are not safe direct HTTPS media stay wrapped", () => {
  for (const target of [
    "http://cdn.example/master.m3u8",
    "https://user:pass@cdn.example/master.m3u8",
    "https://127.0.0.1/master.m3u8",
  ]) {
    const wrapped = `https://cors.corsflix.net/m3u8?url=${encodeURIComponent(target)}`;
    expect(unwrapRivestreamProxyUrl(wrapped)).toBe(wrapped);
  }
});

test("HLS expansion and exact rendition selection use the candidate headers and retain manifest tracks", async () => {
  const url = wrapper("proxy.valhallastream.com", { Referer: "https://media.example/" });
  const context: ProviderRuntimeContext = {
    providerId: "rivestream",
    now: () => "2026-10-24T00:00:00Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (target, init) => {
        const href = String(target);
        if (href.includes("/api/providers"))
          return Response.json({ data: ["citadel", "vanguard"] });
        if (href.includes("/api/"))
          return Response.json({ data: { sources: [{ url, quality: "720p", format: "hls" }] } });
        if (new Headers(init?.headers).get("referer") !== "https://media.example/")
          return new Response("denied", { status: 403 });
        if (href === url) return new Response(MASTER);
        if (href.endsWith(".m3u8")) return new Response("#EXTM3U\n#EXTINF:5,\nsegment.ts\n");
        return new Response(new Uint8Array(2048));
      },
    },
  };
  const result = await rivestreamProviderModule.resolve(INPUT, context);
  expect(result.status).toBe("resolved");
  expect(result.streams.map((s) => s.qualityLabel)).toEqual(["1080p", "720p"]);
  expect(result.streams.map((s) => s.url)).toEqual([
    "https://proxy.valhallastream.com/1080.m3u8",
    "https://proxy.valhallastream.com/720.m3u8",
  ]);
  expect(
    result.streams.every(
      (s) => s.protocol === "hls" && s.headers?.referer === "https://media.example/",
    ),
  ).toBe(true);
  expect(result.streams.every((s) => s.audioLanguages?.includes("en"))).toBe(true);
  expect(result.subtitles.map((s) => s.url)).toContain("https://proxy.valhallastream.com/en.vtt");
});

test("an unwrapped corsflix source keeps the wrapper's playback headers through probing", async () => {
  const target = "https://cdn.example/origin/index.m3u8.png?exp=1&sig=abc";
  const wrapped = `https://cors.corsflix.net/m3u8?url=${encodeURIComponent(target)}&headers=${encodeURIComponent(
    JSON.stringify({
      Referer: "https://vidrift.in/",
      Origin: "https://vidrift.in",
      "User-Agent": "browser",
    }),
  )}`;
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio.m3u8.png?exp=1"',
    '#EXT-X-STREAM-INF:BANDWIDTH=24000000,RESOLUTION=3840x1600,AUDIO="audio"',
    "video_2160p.m3u8.png?exp=1",
  ].join("\n");
  const context: ProviderRuntimeContext = {
    providerId: "rivestream",
    now: () => "2026-11-27T00:00:00Z",
    fetch: {
      runtime: "direct-http",
      resolvesLocally: () => false,
      fetch: async (targetInput, init) => {
        const href = String(targetInput);
        if (href.includes("/api/providers")) return Response.json({ data: ["riven"] });
        if (href.includes("/api/provider"))
          return Response.json({
            data: { sources: [{ url: wrapped, quality: "4K", format: "hls" }], captions: [] },
          });
        const headers = new Headers(init?.headers);
        if (
          headers.get("referer") !== "https://vidrift.in/" ||
          headers.get("origin") !== "https://vidrift.in"
        )
          return new Response("denied", { status: 403 });
        if (href === target) return new Response(master);
        if (href.includes("video_2160p.m3u8.png"))
          return new Response("#EXTM3U\n#EXTINF:4,\nsegment.ts\n");
        if (href.endsWith("segment.ts"))
          return new Response(new Uint8Array(2048), {
            status: 206,
            headers: { "content-type": "video/mp2t" },
          });
        return new Response("missing", { status: 404 });
      },
    },
  };
  const result = await rivestreamProviderModule.resolve(INPUT, context);
  expect(result.status).toBe("resolved");
  expect(result.streams).toHaveLength(1);
  expect(result.streams[0]?.url).toBe(target);
  expect(result.streams[0]?.qualityRank).toBe(2160);
  expect(result.streams[0]?.headers).toMatchObject({
    referer: "https://vidrift.in/",
    origin: "https://vidrift.in",
    "user-agent": "browser",
  });
});

test("source switching resolves the requested source's own quality rows", async () => {
  const context: ProviderRuntimeContext = {
    providerId: "rivestream",
    now: () => "2026-10-24T00:00:00Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (target) => {
        const url = new URL(String(target));
        if (url.pathname === "/api/providers")
          return Response.json({ data: ["citadel", "vanguard"] });
        if (url.pathname === "/api/provider") {
          const source = url.searchParams.get("provider");
          return Response.json({
            data: {
              sources: [
                {
                  url: `https://cdn.example/${source}.mp4`,
                  quality: source === "vanguard" ? "1080p" : "720p",
                },
              ],
            },
          });
        }
        return new Response(new Uint8Array(2048));
      },
    },
  };
  const result = await rivestreamProviderModule.resolve(
    { ...INPUT, preferredSourceId: "source:rivestream:vanguard" },
    context,
  );
  expect(result.status).toBe("resolved");
  expect(result.streams.map((s) => [s.sourceId, s.qualityLabel, s.url])).toEqual([
    ["source:rivestream:vanguard", "1080p", "https://cdn.example/vanguard.mp4"],
  ]);
});

test("observed extensionless HLS media keeps its protocol without inventing qualities", async () => {
  const context: ProviderRuntimeContext = {
    providerId: "rivestream",
    now: () => "2026-10-24T00:00:00Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (target) => {
        const url = String(target);
        if (url.includes("/api/providers")) return Response.json({ data: ["citadel"] });
        if (url.includes("/api/"))
          return Response.json({
            data: {
              sources: [{ url: "https://worker.example/opaque", format: "hls", quality: "720p" }],
            },
          });
        if (url.endsWith("/opaque")) return new Response("#EXTM3U\n#EXTINF:5,\nsegment.ts\n");
        return new Response(new Uint8Array(2048));
      },
    },
  };
  const result = await rivestreamProviderModule.resolve(INPUT, context);
  expect(result.streams).toHaveLength(1);
  expect(result.streams[0]?.protocol).toBe("hls");
  expect(result.streams[0]?.url).toBe("https://worker.example/opaque");
});
