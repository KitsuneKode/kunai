import { afterEach, beforeEach, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { clearRivestreamCachesForTest, rivestreamProviderModule } from "../src/rivestream/direct";

beforeEach(() => clearRivestreamCachesForTest());
afterEach(() => clearRivestreamCachesForTest());

test("the shipped stream is verified even when rank ordering prefers a later unprobed rung", async () => {
  const lowUrl = "https://low-cdn.example/720.mp4";
  const highUrl = "https://high-cdn.example/1080.mp4";
  const probes: string[] = [];
  const context: ProviderRuntimeContext = {
    now: () => "2026-11-27T00:00:00.000Z",
    signal: new AbortController().signal,
    fetch: {
      runtime: "direct-http",
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/api/providers")) return Response.json({ data: ["citadel"] });
        if (url.includes("/api/provider?")) {
          return Response.json({
            data: {
              sources: [
                { url: lowUrl, quality: "720p" },
                { url: highUrl, quality: "1080p" },
              ],
              captions: [],
            },
          });
        }
        if (url === highUrl) {
          probes.push(url);
          return new Response("fixture refusal", { status: 403 });
        }
        if (url === lowUrl) {
          probes.push(url);
          return new Response(null, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": "1024" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    },
  };

  const result = await rivestreamProviderModule.resolve(
    {
      title: { id: "tmdb:550", tmdbId: "550", kind: "movie", title: "Fight Club" },
      mediaKind: "movie",
      startupPriority: "balanced",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    context,
  );

  expect(result.status).toBe("resolved");
  expect(probes).toContain(highUrl);
  const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
  expect(selected?.url).toBe(lowUrl);
  expect(result.streams.map((stream) => stream.url)).toEqual([lowUrl]);
});
