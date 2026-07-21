import { afterEach, expect, test } from "bun:test";

import { AniSkipTimingSource, IntroDbTimingSource } from "@/infra/timing";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("IntroDbTimingSource uses provider-native TMDB id for anime titles", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        tmdb_id: 999,
        type: "series",
        credits: [{ start_ms: 1400000, end_ms: 1440000 }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;

  const title = {
    id: "allanime-opaque-id",
    type: "series" as const,
    name: "Provider Native Anime",
    externalIds: { tmdbId: "999" },
  };

  expect(IntroDbTimingSource.canHandle(title, "anime")).toBe(true);

  const timing = await IntroDbTimingSource.fetch({
    title,
    episode: { season: 1, episode: 7 },
  });

  expect(timing?.tmdbId).toBe("999");
  expect(timing?.credits).toEqual([{ startMs: 1400000, endMs: 1440000 }]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("tmdb_id=999");
  expect(calls[0]).toContain("season=1");
  expect(calls[0]).toContain("episode=7");
});

test("IntroDbTimingSource reports identity-missing without a TMDB-shaped id", async () => {
  const detailed = await IntroDbTimingSource.fetchDetailed!({
    title: {
      id: "allanime-opaque-id",
      type: "series",
      name: "No TMDB",
    },
    episode: { season: 1, episode: 1 },
  });

  expect(detailed.metadata).toBeNull();
  expect(detailed.failureClass).toBe("identity-missing");
});

test("IntroDbTimingSource rejects bare numeric anime ids without proven TMDB", async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const title = {
    id: "154587",
    type: "series" as const,
    name: "AniList Bare Numeric",
  };

  expect(IntroDbTimingSource.canHandle(title, "anime")).toBe(false);

  const detailed = await IntroDbTimingSource.fetchDetailed!({
    title,
    episode: { season: 1, episode: 1 },
    context: { mode: "anime" },
  });

  expect(fetched).toBe(false);
  expect(detailed.metadata).toBeNull();
  expect(detailed.failureClass).toBe("identity-missing");
});

test("IntroDbTimingSource classifies HTTP 404 as not-found", async () => {
  globalThis.fetch = (async () =>
    new Response("missing", { status: 404 })) as unknown as typeof fetch;

  const detailed = await IntroDbTimingSource.fetchDetailed!({
    title: { id: "42", type: "series", name: "Gone" },
    episode: { season: 1, episode: 1 },
  });

  expect(detailed.metadata).toBeNull();
  expect(detailed.failureClass).toBe("not-found");
});

test("IntroDbTimingSource classifies offline DNS failures", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed: getaddrinfo ENOTFOUND api.theintrodb.org");
  }) as unknown as typeof fetch;

  const detailed = await IntroDbTimingSource.fetchDetailed!({
    title: { id: "42", type: "series", name: "Offline" },
    episode: { season: 1, episode: 1 },
  });

  expect(detailed.metadata).toBeNull();
  expect(detailed.failureClass).toBe("offline");
});

test("AniSkipTimingSource reports identity-missing when MAL cannot be resolved", async () => {
  globalThis.fetch = (async () => {
    throw new Error("should not fetch AniSkip without MAL");
  }) as unknown as typeof fetch;

  const detailed = await AniSkipTimingSource.fetchDetailed!({
    title: {
      id: "opaque-show",
      type: "series",
      name: "",
    },
    episode: { season: 1, episode: 1 },
    context: { providerId: "unknown-provider" },
  });

  expect(detailed.metadata).toBeNull();
  expect(detailed.failureClass).toBe("identity-missing");
});
