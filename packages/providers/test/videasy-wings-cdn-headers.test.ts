import { describe, expect, test } from "bun:test";

import type { CachePolicy, ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { createVidkingResultFromPayload, isWingsCdnHost } from "../src/videasy/direct";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "videasy",
  now: () => "2026-09-09T00:00:00.000Z",
};

const TEST_INPUT: ProviderResolveInput = {
  title: { id: "299167", kind: "series", title: "Dutton Ranch", tmdbId: "299167" },
  mediaKind: "series",
  episode: { season: 1, episode: 1 },
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

const TEST_POLICY: CachePolicy = {
  ttlClass: "stream-manifest",
  scope: "local",
  keyParts: ["provider", "videasy"],
};

describe("isWingsCdnHost", () => {
  test("matches the wings CDN family by suffix", () => {
    expect(isWingsCdnHost("https://moon.peakstorm.top/vd/x/index-s1080p-v1-a1.m3u8")).toBe(true);
    expect(isWingsCdnHost("https://primecomet.top/seg-1-s1080p-v1-a1.m4s")).toBe(true);
    expect(isWingsCdnHost("https://cdn.vidking.example/original/1080/index.m3u8")).toBe(false);
    expect(isWingsCdnHost("https://evil-peakstorm.top.evil.test/v.m3u8")).toBe(false);
    expect(isWingsCdnHost("not a url")).toBe(false);
  });
});

describe("wings CDN stream headers", () => {
  test("omit origin on wings CDN hosts; the playlist gate 403s any Origin", () => {
    const result = createVidkingResultFromPayload({
      input: TEST_INPUT,
      cachePolicy: TEST_POLICY,
      apiRoute: "wings-cdn",
      payload: {
        sources: [
          { url: "https://moon.peakstorm.top/vd/x/index-s1080p-v1-a1.m3u8", quality: "1080p" },
        ],
      },
      server: "wings-cdn",
      context: TEST_CONTEXT,
      streamOrigin: "https://www.cineby.at",
    });
    const headers = result?.streams[0]?.headers ?? {};
    expect(headers.referer).toBeTruthy();
    expect(headers["user-agent"]).toBeTruthy();
    expect("origin" in headers).toBe(false);
  });

  test("keep origin on non-CDN hosts", () => {
    const result = createVidkingResultFromPayload({
      input: TEST_INPUT,
      cachePolicy: TEST_POLICY,
      apiRoute: "wings-cdn",
      payload: {
        sources: [
          { url: "https://cdn.vidking.example/original/1080/index.m3u8", quality: "1080p" },
        ],
      },
      server: "wings-cdn",
      context: TEST_CONTEXT,
      streamOrigin: "https://www.cineby.at",
    });
    expect(result?.streams[0]?.headers?.origin).toBe("https://www.cineby.at");
  });
});
