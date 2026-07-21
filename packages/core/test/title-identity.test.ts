import { expect, test } from "bun:test";

import {
  mergeBackfillExternalIds,
  mergeProviderNativeId,
  resolveCanonicalCatalogTitleId,
  resolvePersistedHistoryTitle,
  resolveProviderTitleIdentity,
} from "../src/title-identity";

test("resolveProviderTitleIdentity uses anilistId for anilist catalog providers", () => {
  const identity = resolveProviderTitleIdentity(
    {
      id: "20431",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431" },
    },
    "anilist",
  );

  expect(identity.id).toBe("20431");
  expect(identity.anilistId).toBe("20431");
});

test("resolveProviderTitleIdentity keeps opaque id for provider-native catalog", () => {
  const identity = resolveProviderTitleIdentity(
    {
      id: "bxCKTnota29uSRnZw",
      kind: "anime",
      title: "Hoozuki no Reitetsu",
      externalIds: { anilistId: "20431", malId: "20431" },
    },
    "provider-native",
  );

  expect(identity.id).toBe("bxCKTnota29uSRnZw");
  expect(identity.anilistId).toBe("20431");
});

test("resolveProviderTitleIdentity prefers stored provider native id", () => {
  const identity = resolveProviderTitleIdentity(
    {
      id: "20431",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: {
        anilistId: "20431",
        providerNativeIds: { allanime: "bxCKTnota29uSRnZw" },
      },
    },
    "provider-native",
    "allanime",
  );

  expect(identity.id).toBe("bxCKTnota29uSRnZw");
  expect(identity.anilistId).toBe("20431");
});

test("resolveProviderTitleIdentity uses tmdbId for tmdb catalog providers", () => {
  const identity = resolveProviderTitleIdentity(
    {
      id: "1396",
      kind: "series",
      title: "Breaking Bad",
      externalIds: { tmdbId: "1396" },
    },
    "tmdb",
  );

  expect(identity.id).toBe("1396");
  expect(identity.tmdbId).toBe("1396");
  expect(identity.anilistId).toBeUndefined();
});

test("resolveProviderTitleIdentity does not infer anilistId from bare numeric id on provider-native", () => {
  const identity = resolveProviderTitleIdentity(
    {
      id: "20431",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431" },
    },
    "provider-native",
  );

  expect(identity.id).toBe("20431");
  expect(identity.anilistId).toBe("20431");
});

test("resolveCanonicalCatalogTitleId prefers anilist over session id", () => {
  expect(
    resolveCanonicalCatalogTitleId({
      id: "bxCKTnota29uSRnZw",
      kind: "anime",
      externalIds: { anilistId: "20431" },
    }),
  ).toBe("20431");
});

test("resolveCanonicalCatalogTitleId keeps tmdb-prefixed ids for series", () => {
  expect(
    resolveCanonicalCatalogTitleId({
      id: "tmdb:1",
      kind: "series",
      externalIds: { tmdbId: "1", anilistId: "987" },
    }),
  ).toBe("tmdb:1");
});

test("resolvePersistedHistoryTitle stores canonical id and provider native map", () => {
  const persisted = resolvePersistedHistoryTitle(
    {
      id: "bxCKTnota29uSRnZw",
      kind: "anime",
      title: "Hozuki's Coolheadedness",
      externalIds: { anilistId: "20431" },
    },
    "allanime",
  );

  expect(persisted.id).toBe("20431");
  expect(persisted.externalIds?.providerNativeIds?.allanime).toBe("bxCKTnota29uSRnZw");
});

test("mergeProviderNativeId is idempotent", () => {
  const first = mergeProviderNativeId({ anilistId: "20431" }, "allanime", "opaque-1");
  const second = mergeProviderNativeId(first, "allanime", "opaque-1");
  expect(second).toEqual(first);
});

test("resolveCanonicalCatalogTitleId prefers AniList for anime-class series", () => {
  expect(
    resolveCanonicalCatalogTitleId(
      {
        id: "tmdb:13916",
        kind: "series",
        externalIds: { tmdbId: "13916", anilistId: "1535", malId: "1535" },
      },
      { contentClass: "anime" },
    ),
  ).toBe("1535");
});

test("resolveCanonicalCatalogTitleId anime-class series falls back to MAL", () => {
  expect(
    resolveCanonicalCatalogTitleId(
      {
        id: "tmdb:13916",
        kind: "series",
        externalIds: { tmdbId: "13916", malId: "1535" },
      },
      { contentClass: "anime" },
    ),
  ).toBe("1535");
});

test("resolveCanonicalCatalogTitleId anime-class series without anime ids keeps tmdb unit", () => {
  expect(
    resolveCanonicalCatalogTitleId(
      {
        id: "tmdb:13916",
        kind: "series",
        externalIds: { tmdbId: "13916" },
      },
      { contentClass: "anime" },
    ),
  ).toBe("tmdb:13916");
});

test("resolveCanonicalCatalogTitleId general content class never adopts anime ids for series", () => {
  expect(
    resolveCanonicalCatalogTitleId(
      {
        id: "tmdb:1",
        kind: "series",
        externalIds: { tmdbId: "1", anilistId: "987" },
      },
      { contentClass: "general" },
    ),
  ).toBe("tmdb:1");
});

test("resolveCanonicalCatalogTitleId anime-class movie prefers AniList", () => {
  expect(
    resolveCanonicalCatalogTitleId(
      {
        id: "tmdb:129",
        kind: "movie",
        externalIds: { tmdbId: "129", anilistId: "199" },
      },
      { contentClass: "anime" },
    ),
  ).toBe("199");
});

test("mergeBackfillExternalIds preserves existing catalog ids", () => {
  const merged = mergeBackfillExternalIds(
    { anilistId: "20431", providerNativeIds: { miruro: "20431" } },
    {
      anilistId: "99999",
      providerNativeIds: { allanime: "opaque-1" },
    },
  );

  expect(merged?.anilistId).toBe("20431");
  expect(merged?.providerNativeIds).toEqual({ miruro: "20431", allanime: "opaque-1" });
});

test("mergeBackfillExternalIds preserves youtube channel and video ids", () => {
  const merged = mergeBackfillExternalIds(
    { youtubeId: "abc", youtubeChannelId: "UCold" },
    { youtubeId: "xyz", youtubeChannelId: "UCnew", youtubePlaylistId: "PL1" },
  );

  expect(merged).toEqual({
    youtubeId: "abc",
    youtubeChannelId: "UCold",
    youtubePlaylistId: "PL1",
  });
});
