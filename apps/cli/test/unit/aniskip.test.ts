import { afterEach, expect, test } from "bun:test";

import {
  fetchAniSkipTimingMetadata,
  fetchAniSkipTimingMetadataDetailed,
  mapAniSkipTypeToTimingField,
} from "@/aniskip";
import { clearAnidbCachesForTest } from "@kunai/providers";

const originalFetch = globalThis.fetch;
const originalWhich = Bun.which;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Bun.which = originalWhich;
  // The AniDB MAL cache lives in the provider package and outlives a test file.
  clearAnidbCachesForTest();
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
  // The AniDB scrape goes through the provider package's curl transport, which
  // only falls back to `fetch` when no curl is on PATH. Hiding curl is what
  // makes the stub below observable.
  Bun.which = ((_command: string) => null) as typeof Bun.which;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const parsed = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })();
    if (parsed?.hostname === "anidb.app" && parsed.pathname === "/anime/onigiri-3942") {
      return new Response(
        '<html><body><a href="https://myanimelist.net/anime/32606/Onigiri">MAL</a></body></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (parsed?.hostname === "api.aniskip.com") {
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
  const anidbShowCall = calls.find((url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "anidb.app" && parsed.pathname === "/anime/onigiri-3942";
    } catch {
      return false;
    }
  });
  expect(anidbShowCall).toBeDefined();
  expect(calls.some((url) => url.includes("/32606/1?"))).toBe(true);
});

test("fetchAniSkipTimingMetadata refuses TMDB-only MAL resolution for season > 1", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const detailed = await fetchAniSkipTimingMetadataDetailed({
    anilistId: "opaque-catalog-id",
    externalIds: { tmdbId: "13916" },
    season: 2,
    episode: 3,
  });

  expect(detailed.metadata).toBeNull();
  expect(detailed.failureClass).toBe("identity-missing");
  expect(calls.some((url) => url.includes("haglund.dev"))).toBe(false);
  expect(calls.some((url) => url.includes("api.aniskip.com"))).toBe(false);
});

test("fetchAniSkipTimingMetadata resolves TMDB-only identity for season 1", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("arm.haglund.dev/api/v2/themoviedb")) {
      return new Response(JSON.stringify([{ myanimelist: 1535, themoviedb: 13916 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.aniskip.com")) {
      return new Response(
        JSON.stringify({
          found: true,
          results: [{ skipType: "op", interval: { startTime: 5, endTime: 90 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const timing = await fetchAniSkipTimingMetadata({
    anilistId: "opaque-catalog-id",
    externalIds: { tmdbId: "13916" },
    season: 1,
    episode: 3,
  });

  expect(timing?.intro).toEqual([{ startMs: 5000, endMs: 90000 }]);
  expect(calls.some((url) => url.includes("arm.haglund.dev/api/v2/themoviedb"))).toBe(true);
  expect(calls.some((url) => url.includes("/1535/3?"))).toBe(true);
});

test("fetchAniSkipTimingMetadata AniList path is unaffected by season > 1", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("arm.haglund.dev/api/v2/ids")) {
      return new Response(JSON.stringify({ myanimelist: 30013, anilist: 30013 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.aniskip.com")) {
      return new Response(
        JSON.stringify({
          found: true,
          results: [{ skipType: "ed", interval: { startTime: 1200, endTime: 1320 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const timing = await fetchAniSkipTimingMetadata({
    anilistId: "30013",
    season: 2,
    episode: 5,
  });

  expect(timing?.credits).toEqual([{ startMs: 1_200_000, endMs: 1_320_000 }]);
  expect(calls.some((url) => url.includes("arm.haglund.dev/api/v2/themoviedb"))).toBe(false);
  expect(calls.some((url) => url.includes("arm.haglund.dev/api/v2/ids"))).toBe(true);
  expect(calls.some((url) => url.includes("/30013/5?"))).toBe(true);
});
