import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { anilightProviderModule } from "../src/anilight/direct";
import fixture from "./fixtures/anilight/frieren.json";

const INPUT: ProviderResolveInput = {
  title: {
    id: "anilist:154587",
    kind: "anime",
    title: "Frieren: Beyond Journey's End",
    anilistId: "154587",
  },
  episode: { episode: 1 },
  mediaKind: "anime",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

function contextReturning(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ProviderRuntimeContext {
  return {
    providerId: "anilight",
    now: () => "2026-11-27T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (url: string | URL | Request, init?: RequestInit) =>
        handler(url instanceof URL ? url.href : url instanceof Request ? url.url : url, init),
    },
  };
}

function anilightContext(): ProviderRuntimeContext {
  return contextReturning((url) => {
    if (url.includes("/anime/check-exists")) return Response.json(fixture.checkExists);
    if (url.includes("/search?")) return Response.json(fixture.search);
    if (url.includes("/sources/session")) return Response.json(fixture.session);
    if (url.includes("/watch/sousou-no-frieren")) return Response.json(fixture.watch);
    if (url.includes("/sources?") && url.includes("backup=true")) {
      return Response.json({ ...fixture.sources, sources: [], tracks: [] });
    }
    if (url.includes("/sources?")) return Response.json(fixture.sources);
    if (url.startsWith("https://media.satella.buzz/e/")) {
      return new Response(new Uint8Array(2048), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-2047/352648456",
        },
      });
    }
    return new Response("fixture miss", { status: 404 });
  });
}

describe("AniLight direct resolver", () => {
  test("searches its AniList-backed catalog", async () => {
    const results = await anilightProviderModule.search?.({ query: "Frieren" }, anilightContext());
    expect(results?.[0]).toMatchObject({
      id: "sousou-no-frieren",
      title: "Frieren: Beyond Journey's End",
      episodeCount: 28,
      subtitleAvailability: "softsub",
    });
    expect(results?.[0]?.availableAudioModes).toEqual(["sub", "dub"]);
    expect(results?.[0]?.externalIds?.anilistId).toBe("154587");
  });

  test("lists provider-native episode identities", async () => {
    const rows = await anilightProviderModule.listEpisodes?.(
      { title: INPUT.title },
      anilightContext(),
    );
    expect(rows?.[0]).toMatchObject({ index: 1, name: "The Journey's End" });
    expect(rows?.[0]?.providerEpisodeIdentity).toEqual({
      providerId: "anilight",
      value: "ep:1",
    });
  });

  test("resolves a recorded sub payload through the declared media proxy with soft subtitles", async () => {
    const result = await anilightProviderModule.resolve(INPUT, anilightContext());

    expect(result.status).toBe("resolved");
    expect(result.streamReachabilityVerified).toBe(true);
    expect(result.streams[0]?.url).toBe("https://media.satella.buzz/e/redacted-media-token");
    expect(result.streams[0]).toMatchObject({
      protocol: "mp4",
      presentation: "sub",
      qualityLabel: "1080p",
    });
    expect(result.streams[0]?.audioLanguages).toEqual(["ja"]);
    expect(result.subtitles.map((subtitle) => subtitle.language)).toEqual(
      expect.arrayContaining(["en", "es"]),
    );
    expect(result.subtitles[0]?.url).toContain("/proxy/captions?token=");
    expect(result.sources?.some((source) => source.label === "Sub kira")).toBe(true);
  });

  test("fails closed when the requested dub is unavailable", async () => {
    const ctx = contextReturning((url) => {
      if (url.includes("/anime/check-exists")) return Response.json(fixture.checkExists);
      if (url.includes("/watch/")) {
        return Response.json({
          ...fixture.watch,
          episodes: [{ ...fixture.watch.episodes[0], dub: false, dubReleased: false }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const result = await anilightProviderModule.resolve(
      { ...INPUT, preferredAudioLanguage: "en" },
      ctx,
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.message).toContain("no dub audio");
  });
});
