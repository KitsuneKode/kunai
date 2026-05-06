import { expect, test } from "bun:test";

import {
  attachProviderResolveResult,
  episodeToCoreIdentity,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
  titleToCoreIdentity,
} from "@/services/providers/core-manifest-adapter";
import { allanimeManifest, miruroManifest, vidkingManifest } from "@kunai/core";

test("core provider manifest maps to the current CLI provider shape", () => {
  const metadata = manifestToProviderMetadata(vidkingManifest);
  const capabilities = manifestToProviderCapabilities(vidkingManifest);

  expect(metadata.id).toBe("vidking");
  expect(metadata.name).toBe("VidKing");
  expect(metadata.isAnimeProvider).toBe(false);
  expect(capabilities.contentTypes).toEqual(["movie", "series"]);
});

test("cli title and episode identities map to shared provider identities", () => {
  expect(
    titleToCoreIdentity({ id: "438631", type: "movie", name: "Dune", year: "2021" }, "series"),
  ).toEqual({
    id: "438631",
    kind: "movie",
    title: "Dune",
    year: 2021,
    tmdbId: "438631",
    anilistId: undefined,
  });

  expect(episodeToCoreIdentity({ season: 1, episode: 2, name: "Pilot" })).toEqual({
    season: 1,
    episode: 2,
    title: "Pilot",
    airDate: undefined,
  });
});

test("anime core manifests stay anime-only while CLI adapters own compatibility", () => {
  const allanimeMetadata = manifestToProviderMetadata(allanimeManifest);
  const miruroMetadata = manifestToProviderMetadata(miruroManifest);

  expect(allanimeMetadata.isAnimeProvider).toBe(true);
  expect(miruroMetadata.isAnimeProvider).toBe(true);
  expect(manifestToProviderCapabilities(allanimeManifest).contentTypes).toEqual(["series"]);
  expect(manifestToProviderCapabilities(miruroManifest).contentTypes).toEqual([]);
});

test("attachProviderResolveResult adds shared trace and cache policy to an existing stream", () => {
  const stream = attachProviderResolveResult({
    manifest: miruroManifest,
    request: {
      title: { id: "demon-slayer", type: "series", name: "Demon Slayer" },
      episode: { season: 1, episode: 1 },
      subLang: "english",
    },
    stream: {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      audioLanguage: "sub",
      hardSubLanguage: "en",
      timestamp: 1,
    },
    mode: "anime",
    runtime: "direct-http",
  });

  expect(stream.providerResolveResult?.providerId).toBe("miruro");
  expect(stream.providerResolveResult?.trace.title.kind).toBe("anime");
  expect(stream.providerResolveResult?.trace.runtime).toBe("direct-http");
  expect(stream.providerResolveResult?.streams[0]?.hardSubLanguage).toBe("en");
  expect(stream.providerResolveResult?.cachePolicy?.keyParts).toContain("english");
});
