import { afterEach, expect, test } from "bun:test";

import { fetchAniSkipTimingMetadata, mapAniSkipTypeToTimingField } from "@/aniskip";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("mapAniSkipTypeToTimingField only accepts playback skip categories we intentionally support", () => {
  expect(mapAniSkipTypeToTimingField("op")).toBe("intro");
  expect(mapAniSkipTypeToTimingField("mixed-op")).toBe("intro");
  expect(mapAniSkipTypeToTimingField("ed")).toBe("credits");
  expect(mapAniSkipTypeToTimingField("mixed-ed")).toBe("credits");
  expect(mapAniSkipTypeToTimingField("recap")).toBe("recap");

  expect(mapAniSkipTypeToTimingField("prologue")).toBeNull();
  expect(mapAniSkipTypeToTimingField("epilogue")).toBeNull();
  expect(mapAniSkipTypeToTimingField("preview")).toBeNull();
});

test("fetchAniSkipTimingMetadata uses provider-native MAL id before lookup fallbacks", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        found: true,
        results: [{ skipType: "op", interval: { startTime: 12, endTime: 88 } }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const timing = await fetchAniSkipTimingMetadata({
    anilistId: "opaque-provider-id",
    externalIds: { malId: "32182", anilistId: "21507" },
    titleName: "Demon Slayer",
    episode: 1,
  });

  expect(timing?.intro).toEqual([{ startMs: 12000, endMs: 88000 }]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("/32182/1?");
  expect(calls.some((url) => url.includes("haglund.dev") || url.includes("anilist.co"))).toBe(
    false,
  );
});

test("fetchAniSkipTimingMetadata resolves MAL id from AniDB show page for opaque anidb catalog ids", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("anidb.app/anime/onigiri-3942")) {
      return new Response(
        '<html><body><a href="https://myanimelist.net/anime/32606/Onigiri">MAL</a></body></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.includes("api.aniskip.com")) {
      return new Response(
        JSON.stringify({
          found: true,
          results: [{ skipType: "op", interval: { startTime: 0, endTime: 30 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const timing = await fetchAniSkipTimingMetadata({
    anilistId: "onigiri-3942",
    titleName: "Onigiri",
    providerId: "anidb",
    episode: 1,
  });

  expect(timing?.intro).toEqual([{ startMs: 0, endMs: 30000 }]);
  expect(calls.some((url) => url.includes("anidb.app/anime/onigiri-3942"))).toBe(true);
  expect(calls.some((url) => url.includes("/32606/1?"))).toBe(true);
});
