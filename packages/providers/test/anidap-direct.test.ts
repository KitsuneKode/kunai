import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { anidapProviderModule, transformAnidapSourceUrl } from "../src/anidap/direct";
import fixture from "./fixtures/anidap/one-piece.json";

const INPUT: ProviderResolveInput = {
  title: { id: "anilist:21", kind: "anime", title: "One Piece", anilistId: "21" },
  episode: { episode: 1 },
  mediaKind: "anime",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

function contextReturning(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ProviderRuntimeContext {
  return {
    providerId: "anidap",
    now: () => "2026-11-27T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (url: string | URL | Request, init?: RequestInit) =>
        handler(url instanceof URL ? url.href : url instanceof Request ? url.url : url, init),
    },
  };
}

function anidapContext(): ProviderRuntimeContext {
  return contextReturning((url, init) => {
    if (url === "https://graphql.anidap.lol/graphql") {
      const body = init?.body ? String(init.body) : "";
      if (body.includes("searchAnime")) {
        return Response.json({ data: { searchAnime: { items: [fixture.anime] } } });
      }
      return Response.json({ data: { anime: fixture.anime } });
    }
    if (url.includes("/rest/api/episodes")) return Response.json(fixture.episodes);
    if (url.includes("/rest/api/servers")) return Response.json(fixture.servers);
    if (url.includes("/rest/api/sources") && url.includes("providerId=nero")) {
      return Response.json(fixture.sources["sub-nero"]);
    }
    if (url.includes("/rest/api/sources") && url.includes("providerId=yuki")) {
      return Response.json(fixture.sources["sub-yuki"]);
    }
    if (url.endsWith("/master.m3u8")) {
      return new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\nvideo.m3u8\n",
        {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        },
      );
    }
    if (url.endsWith("/video.m3u8")) {
      return new Response("#EXTM3U\n#EXTINF:6.0,\nseg-1.ts\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
    if (url.endsWith("/seg-1.ts")) {
      return new Response(new Uint8Array(2048), {
        status: 206,
        headers: { "content-type": "video/mp2t", "content-range": "bytes 0-2047/2048" },
      });
    }
    return new Response("fixture miss", { status: 404 });
  });
}

describe("Anidap direct resolver", () => {
  test("searches its GraphQL catalog", async () => {
    const rows = await anidapProviderModule.search?.({ query: "One Piece" }, anidapContext());
    expect(rows?.[0]).toMatchObject({
      id: "one-piece-p8k27",
      title: "ONE PIECE",
      subtitleAvailability: "softsub",
    });
    expect(rows?.[0]?.externalIds).toMatchObject({ anilistId: "21", malId: "21" });
  });

  test("lists provider-native episode identities", async () => {
    const rows = await anidapProviderModule.listEpisodes?.({ title: INPUT.title }, anidapContext());
    expect(rows?.[0]?.providerEpisodeIdentity).toEqual({ providerId: "anidap", value: "ep:1" });
    expect(rows?.[0]?.name).toContain("Luffy");
  });

  test("resolves every recorded sub server slot with provider headers and subtitles", async () => {
    const result = await anidapProviderModule.resolve(INPUT, anidapContext());

    expect(result.status).toBe("resolved");
    expect(result.streamReachabilityVerified).toBe(true);
    expect(result.streams).toHaveLength(2);
    expect(result.sources?.map((source) => source.label)).toEqual(
      expect.arrayContaining(["Sub nero", "Sub yuki", "Dub nero"]),
    );
    expect(result.sources?.find((source) => source.label === "Sub nero")?.status).toBe("selected");
    expect(result.streams[0]?.headers?.Referer).toBe("https://animex.one/");
    expect(result.streams[0]?.presentation).toBe("sub");
    expect(result.streams[0]?.audioLanguages).toEqual(["ja"]);
    expect(result.subtitles.map((subtitle) => subtitle.language)).toContain("en");
  });

  test("uses a pinned source id to order the matching server first", async () => {
    const result = await anidapProviderModule.resolve(
      { ...INPUT, preferredSourceId: "source:anidap:sub-yuki" },
      anidapContext(),
    );
    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.sourceId).toBe("source:anidap:sub_yuki");
  });

  test("keeps the public shiro URL transformation shape", () => {
    expect(transformAnidapSourceUrl("https://kem.example/watch", "shiro")).toMatch(
      /^https:\/\/hls\.dramavideo\.se\/media\/[0-9a-f]+&origin=https:\/\/kem\.clvd\.xyz\/$/,
    );
  });
});
