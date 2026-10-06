import { expect, test } from "bun:test";

import {
  buildApiStreamResolveCacheKey,
  buildEmbedStreamCacheKey,
} from "@/services/cache/stream-resolve-cache";
import {
  allanimeManifest,
  flavorSourceId,
  videasyManifest,
  youtubeManifest,
} from "@kunai/providers";

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

test("buildApiStreamResolveCacheKey separates provider-native episode identities", () => {
  const input = {
    providerId: "allanime",
    providerManifest: allanimeManifest,
    title: { id: "native-show", type: "series" as const, name: "X" },
    episode: { season: 1, episode: 1 },
    mode: "anime" as const,
    audioPreference: "original",
    subtitlePreference: "en",
  };

  expect(
    buildApiStreamResolveCacheKey({
      ...input,
      episode: {
        ...input.episode,
        providerEpisodeIdentity: { providerId: "allanime", value: "0" },
      },
    }),
  ).not.toBe(
    buildApiStreamResolveCacheKey({
      ...input,
      episode: {
        ...input.episode,
        providerEpisodeIdentity: { providerId: "allanime", value: "1" },
      },
    }),
  );

  expect(
    buildApiStreamResolveCacheKey({
      ...input,
      episode: {
        ...input.episode,
        providerEpisodeIdentity: { providerId: "allanime", value: "OVA" },
      },
    }),
  ).not.toBe(
    buildApiStreamResolveCacheKey({
      ...input,
      episode: {
        ...input.episode,
        providerEpisodeIdentity: { providerId: "allanime", value: "ova" },
      },
    }),
  );

  expect(
    buildApiStreamResolveCacheKey({
      ...input,
      episode: {
        ...input.episode,
        providerEpisodeIdentity: { providerId: "allanime", value: " SP1 " },
      },
    }),
  ).not.toBe(
    buildApiStreamResolveCacheKey({
      ...input,
      episode: {
        ...input.episode,
        providerEpisodeIdentity: { providerId: "allanime", value: "SP1" },
      },
    }),
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
  // audio now sits between episode and subtitle: switching audio must not reuse
  // a stream cached for the previous choice.
  expect(key).toContain("provider:videasy:series:tmdb:1:2:7:original:en:720p:balanced:none:none");
});

test("changing the audio preference changes the key for videasy", () => {
  // Regression for the drift where videasy omitted `audio` from keyParts, so a
  // dub<->sub switch reused the stream cached for the previous choice.
  const base = {
    providerId: "videasy",
    providerManifest: videasyManifest,
    title: { id: "tmdb:1", type: "series" as const, name: "X" },
    episode: { season: 2, episode: 7 },
    mode: "series" as const,
    subtitlePreference: "en",
    qualityPreference: "720p",
  };
  expect(buildApiStreamResolveCacheKey({ ...base, audioPreference: "original" })).not.toBe(
    buildApiStreamResolveCacheKey({ ...base, audioPreference: "en" }),
  );
});

test("two YouTube video ids cannot share one stream resolve key", () => {
  const base = {
    providerId: "youtube",
    providerManifest: youtubeManifest,
    episode: { season: 0, episode: 0 },
    mode: "youtube" as const,
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "1080p",
  };

  const first = buildApiStreamResolveCacheKey({
    ...base,
    title: { id: "youtube:video:first", type: "movie", name: "First" },
  });
  const second = buildApiStreamResolveCacheKey({
    ...base,
    title: { id: "youtube:video:second", type: "movie", name: "Second" },
  });

  expect(first).not.toBe(second);
});

test("Vyse and Fade stay distinct despite sharing the hdmovie backend", () => {
  const base = {
    providerId: "videasy",
    providerManifest: videasyManifest,
    title: { id: "tmdb:1", type: "series" as const, name: "X" },
    episode: { season: 2, episode: 7 },
    mode: "series" as const,
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "1080p",
  };

  const vyse = buildApiStreamResolveCacheKey({
    ...base,
    selectedSourceId: flavorSourceId("cineby-vyse"),
  });
  const fade = buildApiStreamResolveCacheKey({
    ...base,
    selectedSourceId: flavorSourceId("cineby-fade"),
  });

  expect(vyse).not.toBe(fade);
});

test("buildEmbedStreamCacheKey preserves embed URL", () => {
  const url = "https://example.com/embed/123";
  expect(buildEmbedStreamCacheKey(url)).toBe(url);
});

test("buildEmbedStreamCacheKey encodes intent and sorted headers", () => {
  const url = "https://example.com/embed/123";
  const keyWithIntent = buildEmbedStreamCacheKey({
    embedPageUrl: url,
    intent: "play",
  });
  expect(keyWithIntent).toBe("https://example.com/embed/123:intent:play");

  const keyWithHeaders = buildEmbedStreamCacheKey({
    embedPageUrl: url,
    intent: "play",
    headers: { Referer: "https://foo.com", "User-Agent": "CustomUA" },
  });
  expect(keyWithHeaders).toBe(
    "https://example.com/embed/123:intent:play:headers:referer=https://foo.com;user-agent=CustomUA",
  );
});

test("buildApiStreamResolveCacheKey separates YouTube episodes under channel/playlist", () => {
  const base = {
    providerId: "youtube",
    providerManifest: youtubeManifest,
    title: { id: "channel:UC123", type: "series" as const, name: "Channel" },
    mode: "series" as const,
    audioPreference: "original",
    subtitlePreference: "none",
  };

  const ep1 = buildApiStreamResolveCacheKey({
    ...base,
    episode: { season: 1, episode: 1 },
  });
  const ep2 = buildApiStreamResolveCacheKey({
    ...base,
    episode: { season: 1, episode: 2 },
  });

  expect(ep1).not.toBe(ep2);
  expect(ep1).toContain(":1:");
  expect(ep2).toContain(":2:");
});

test("a manifest with a missing or malformed cachePolicy degrades to a plain key", () => {
  const title = { id: "abc", type: "series" as const, name: "X", year: "2020" };
  const base = {
    providerId: "vidlink",
    title,
    episode: { season: 1, episode: 3 },
    mode: "series" as const,
    audioPreference: "original",
    subtitlePreference: "en",
    qualityPreference: "1080p",
  };

  expect(() =>
    buildApiStreamResolveCacheKey({ ...base, providerManifest: undefined }),
  ).not.toThrow();
  expect(() =>
    buildApiStreamResolveCacheKey({
      ...base,
      // SAFETY: a cache record missing cachePolicy must not crash the key
      // builder — cache payloads are untrusted at read time.
      providerManifest: { id: "vidlink" } as never,
    }),
  ).not.toThrow();
  expect(() =>
    buildApiStreamResolveCacheKey({
      ...base,
      // SAFETY: same — a string where the cachePolicy object belongs.
      providerManifest: { id: "vidlink", cachePolicy: "not-an-object" } as never,
    }),
  ).not.toThrow();
});
