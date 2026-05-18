import { afterEach, expect, test } from "bun:test";

import { IntroDbTimingSource } from "@/infra/timing";

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
  }) as typeof fetch;

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
