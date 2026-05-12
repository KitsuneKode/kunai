import { expect, test } from "bun:test";

import {
  buildApiStreamResolveCacheKey,
  buildEmbedStreamCacheKey,
} from "@/services/cache/stream-resolve-cache";
import { allanimeManifest, vidkingManifest } from "@kunai/providers";

test("buildApiStreamResolveCacheKey is stable and encodes prefs", () => {
  const title = { id: "abc", type: "series" as const, name: "X", year: "2020" };
  const episode = { season: 1, episode: 3 };
  const a = buildApiStreamResolveCacheKey({
    providerId: "allanime",
    providerManifest: allanimeManifest,
    title,
    episode,
    mode: "anime",
    audioPreference: "original",
    subtitlePreference: "en",
  });
  const b = buildApiStreamResolveCacheKey({
    providerId: "allanime",
    providerManifest: allanimeManifest,
    title,
    episode,
    mode: "anime",
    audioPreference: "original",
    subtitlePreference: "en",
  });
  expect(a).toContain(":anime:");
  expect(a).toContain(":original:");
  expect(a).toContain(":en");
  expect(a).toBe(b);
});

test("buildApiStreamResolveCacheKey follows provider manifest key parts", () => {
  const key = buildApiStreamResolveCacheKey({
    providerId: "vidking",
    providerManifest: vidkingManifest,
    title: { id: "tmdb:1", type: "series", name: "X" },
    episode: { season: 2, episode: 7 },
    mode: "series",
    audioPreference: "original",
    subtitlePreference: "en",
  });
  expect(key).toContain("provider:vidking:series:tmdb:1:2:7:en");
});

test("buildEmbedStreamCacheKey preserves embed URL", () => {
  const url = "https://example.com/embed/123";
  expect(buildEmbedStreamCacheKey(url)).toBe(url);
});
