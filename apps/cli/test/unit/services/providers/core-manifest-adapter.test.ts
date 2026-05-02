import { expect, test } from "bun:test";

import {
  attachProviderResolveResult,
  episodeToCoreIdentity,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
  titleToCoreIdentity,
} from "@/services/providers/core-manifest-adapter";
import { allanimeManifest, cinebyAnimeManifest, vidkingManifest } from "@kunai/core";

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

test("anime core manifests remain anime providers but expose series-compatible CLI content type", () => {
  const allanimeMetadata = manifestToProviderMetadata(allanimeManifest);
  const cinebyAnimeMetadata = manifestToProviderMetadata(cinebyAnimeManifest);

  expect(allanimeMetadata.isAnimeProvider).toBe(true);
  expect(cinebyAnimeMetadata.isAnimeProvider).toBe(true);
  expect(manifestToProviderCapabilities(allanimeManifest).contentTypes).toEqual(["series"]);
  expect(manifestToProviderCapabilities(cinebyAnimeManifest).contentTypes).toEqual(["series"]);
});

test("attachProviderResolveResult adds shared trace and cache policy to an existing stream", () => {
  const stream = attachProviderResolveResult({
    manifest: cinebyAnimeManifest,
    request: {
      title: { id: "demon-slayer", type: "series", name: "Demon Slayer" },
      episode: { season: 1, episode: 1 },
      subLang: "english",
    },
    stream: {
      url: "https://cdn.example/master.m3u8",
      headers: {},
      timestamp: 1,
    },
    mode: "anime",
    runtime: "playwright-lease",
  });

  expect(stream.providerResolveResult?.providerId).toBe("cineby-anime");
  expect(stream.providerResolveResult?.trace.title.kind).toBe("anime");
  expect(stream.providerResolveResult?.trace.runtime).toBe("playwright-lease");
  expect(stream.providerResolveResult?.cachePolicy?.keyParts).toContain("english");
});
