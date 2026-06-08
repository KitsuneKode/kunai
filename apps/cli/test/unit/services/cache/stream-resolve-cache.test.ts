import { expect, test } from "bun:test";

import {
  buildApiStreamResolveCacheKey,
  buildEmbedStreamCacheKey,
} from "@/services/cache/stream-resolve-cache";
import { allanimeManifest, videasyManifest } from "@kunai/providers";

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
    qualityPreference: "1080p",
    selectedSourceId: "source-a",
    selectedStreamId: "stream-a-1080",
  });
  const b = buildApiStreamResolveCacheKey({
    providerId: "allanime",
    providerManifest: allanimeManifest,
    title,
    episode,
    mode: "anime",
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "1080p",
    selectedSourceId: "source-a",
    selectedStreamId: "stream-a-1080",
  });
  expect(a).toContain(":anime:");
  expect(a).toContain(":original:");
  expect(a).toContain(":en");
  expect(a).toContain(":1080p");
  expect(a).toContain(":source-a");
  expect(a).toContain(":stream-a-1080");
  expect(a).toBe(b);
});

test("buildApiStreamResolveCacheKey separates source and stream selections", () => {
  const common = {
    providerId: "videasy",
    providerManifest: videasyManifest,
    title: { id: "tmdb:1", type: "series" as const, name: "X" },
    episode: { season: 2, episode: 7 },
    mode: "series" as const,
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "720p",
  };
  const sourceA = buildApiStreamResolveCacheKey({
    ...common,
    selectedSourceId: "source-a",
    selectedStreamId: "stream-a-720",
  });
  const sourceB = buildApiStreamResolveCacheKey({
    ...common,
    selectedSourceId: "source-b",
    selectedStreamId: "stream-b-720",
  });
  expect(sourceA).not.toBe(sourceB);
});

test("buildApiStreamResolveCacheKey separates startup priority", () => {
  const input = {
    providerId: "videasy",
    providerManifest: videasyManifest,
    title: { id: "tmdb:1", type: "series" as const, name: "X" },
    episode: { season: 2, episode: 7 },
    mode: "series" as const,
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "720p",
  };

  expect(buildApiStreamResolveCacheKey({ ...input, startupPriority: "fast" })).not.toBe(
    buildApiStreamResolveCacheKey({ ...input, startupPriority: "quality-first" }),
  );
});

test("buildApiStreamResolveCacheKey follows provider manifest key parts", () => {
  const key = buildApiStreamResolveCacheKey({
    providerId: "videasy",
    providerManifest: videasyManifest,
    title: { id: "tmdb:1", type: "series", name: "X" },
    episode: { season: 2, episode: 7 },
    mode: "series",
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "720p",
  });
  expect(key).toContain("provider:videasy:series:tmdb:1:2:7:en:720p:balanced:none:none");
});

test("buildEmbedStreamCacheKey preserves embed URL", () => {
  const url = "https://example.com/embed/123";
  expect(buildEmbedStreamCacheKey(url)).toBe(url);
});
