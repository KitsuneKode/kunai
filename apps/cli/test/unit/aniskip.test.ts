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
