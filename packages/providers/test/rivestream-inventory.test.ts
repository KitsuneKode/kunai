import { beforeEach, expect, test } from "bun:test";

import type { LooseJsonValue, ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import {
  clearRivestreamCachesForTest,
  parseRivestreamProxyHeaders,
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

test("HLS expansion and exact rendition selection use the candidate headers and retain manifest tracks", async () => {
  const url = wrapper("proxy.valhallastream.com", { Referer: "https://media.example/" });
  const context: ProviderRuntimeContext = {
    providerId: "rivestream",
    now: () => "2026-10-24T00:00:00Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (target, init) => {
        const href = String(target);
        if (href.includes("VideoProviderServices"))
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

test("source switching resolves the requested source's own quality rows", async () => {
  const context: ProviderRuntimeContext = {
    providerId: "rivestream",
    now: () => "2026-10-24T00:00:00Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (target) => {
        const url = new URL(String(target));
        if (url.searchParams.get("requestID") === "VideoProviderServices")
          return Response.json({ data: ["citadel", "vanguard"] });
        if (url.pathname.includes("/api/")) {
          const source = url.searchParams.get("service");
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
        if (url.includes("VideoProviderServices")) return Response.json({ data: ["citadel"] });
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
