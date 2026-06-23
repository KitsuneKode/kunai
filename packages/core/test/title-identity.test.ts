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
