import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { vidboltProviderModule } from "../src/vidbolt/direct";
import fixture from "./fixtures/vidbolt/resolve-movie.json";

const INPUT: ProviderResolveInput = {
  title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
  episode: { season: 1, episode: 1 },
  mediaKind: "movie",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

const firstStep = fixture.steps[0];
if (!firstStep?.body.stream?.sources?.[0] || !("master" in firstStep.body.stream.sources[0])) {
  throw new Error("VidBolt fixture is missing its first HLS master");
}
const MASTER = firstStep.body.stream.sources[0].master;
const MEDIA_PLAYLIST = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg-1.ts\n";
const SEGMENT_BYTES = new Uint8Array(2048);

function contextReturning(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ProviderRuntimeContext {
  return {
    providerId: "vidbolt",
    now: () => "2026-11-27T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (url: string | URL | Request, init?: RequestInit) =>
        handler(url instanceof URL ? url.href : url instanceof Request ? url.url : url, init),
    },
  };
}

function vidboltContext(): ProviderRuntimeContext {
  return contextReturning((url) => {
    if (url.startsWith("https://vidbolt.pro/api/resolve")) {
      const exclude = new URL(url).searchParams.get("exclude") ?? "";
      const step = fixture.steps.find((candidate) => candidate.exclude === exclude);
      return Response.json(step?.body ?? { stream: null });
    }
    if (url.endsWith("/index.m3u8")) {
      return new Response(MASTER, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
    if (url.endsWith("/video_1080p.m3u8") || url.endsWith("/video_720p.m3u8")) {
      return new Response(MEDIA_PLAYLIST, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
    if (url.endsWith("/seg-1.ts")) {
      return new Response(SEGMENT_BYTES, {
        status: 206,
        headers: { "content-type": "video/mp2t", "content-range": "bytes 0-2047/2048" },
      });
    }
    return new Response("fixture miss", { status: 404 });
  });
}

describe("VidBolt direct resolver", () => {
  test("resolves the recorded multi-server payload into source, variant, audio, and subtitle inventory", async () => {
    const result = await vidboltProviderModule.resolve(INPUT, vidboltContext());

    expect(result.status).toBe("resolved");
    expect(result.streamReachabilityVerified).toBe(true);
    expect(result.streams.length).toBeGreaterThan(0);
    expect(result.sources?.map((source) => source.label)).toEqual(
      expect.arrayContaining(["orion", "vega"]),
    );
    expect(result.sources?.find((source) => source.label === "orion")?.status).toBe("selected");
    expect(result.variants?.some((variant) => variant.qualityLabel === "1080p")).toBe(true);
    expect(result.streams[0]?.audioLanguages).toEqual(expect.arrayContaining(["en", "it"]));
    expect(result.subtitles.map((subtitle) => subtitle.language)).toEqual(
      expect.arrayContaining(["en", "ar"]),
    );
  });

  test("rejects anime titles", async () => {
    const result = await vidboltProviderModule.resolve(
      { ...INPUT, mediaKind: "anime" },
      vidboltContext(),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("unsupported-title");
  });

  test("classifies a Cloudflare HTML API challenge as blocked rather than a title miss", async () => {
    const ctx = contextReturning(
      () =>
        new Response("<!DOCTYPE html><title>Attention Required! | Cloudflare</title>", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await vidboltProviderModule.resolve(INPUT, ctx);
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("blocked");
  });
});
