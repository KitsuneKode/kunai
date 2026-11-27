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

test("falls back to the candidate-gated stream when the bounded final probes fail", async () => {
  const lowUrl = "https://low-cdn.example/720.mp4";
  const highUrls = [
    "https://high-a.example/2160.mp4",
    "https://high-b.example/1440.mp4",
    "https://high-c.example/1080.mp4",
  ];
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
                { url: highUrls[0], quality: "2160p" },
                { url: highUrls[1], quality: "1440p" },
                { url: highUrls[2], quality: "1080p" },
              ],
              captions: [],
            },
          });
        }
        if (highUrls.includes(url)) return new Response("fixture refusal", { status: 403 });
        if (url === lowUrl) {
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
  const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
  expect(selected?.url).toBe(lowUrl);
  expect(result.streams.map((stream) => stream.url)).toEqual([lowUrl]);
});

test("does not reuse the candidate-gated stream after the final gate refuses its host", async () => {
  const lowUrl = "https://cdn.example/720.mp4";
  const highUrls = [
    "https://cdn.example/2160.mp4",
    "https://cdn.example/1440.mp4",
    "https://cdn.example/1080.mp4",
  ];
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
                { url: highUrls[0], quality: "2160p" },
                { url: highUrls[1], quality: "1440p" },
                { url: highUrls[2], quality: "1080p" },
              ],
              captions: [],
            },
          });
        }
        if (highUrls.includes(url)) throw new Error("getaddrinfo ENOTFOUND cdn.example");
        if (url === lowUrl) {
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

  expect(result.status).toBe("exhausted");
});
