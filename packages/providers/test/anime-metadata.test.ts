import { afterEach, describe, expect, test } from "bun:test";

import {
  allMangaEpisodeMetadataCacheKey,
  clearAnimeMetadataCacheForTest,
  enrichEpisodeOptionsWithAnimeMetadata,
  episodeMetadataTitleCoverage,
  formatAnimeEpisodeLabel,
  getSeededEpisodeMetadata,
  mergeMiruroPipeEpisodeMetadata,
  parseAllMangaEpisodeNumber,
  pipeEpisodeMetadataTitleCoverage,
  seedEpisodeMetadataFromProvider,
  shouldSkipExternalEpisodeMetadataEnrichment,
  type AnimeEpisodeMetadata,
} from "../src/shared/anime-metadata";

afterEach(() => {
  clearAnimeMetadataCacheForTest();
});

describe("anime metadata helpers", () => {
  test("formatAnimeEpisodeLabel adds filler badge", () => {
    expect(formatAnimeEpisodeLabel(1, "Ryomen Sukuna", { filler: true })).toBe(
      "Episode 1 · Ryomen Sukuna · Filler",
    );
  });

  test("parseAllMangaEpisodeNumber reads detail episode string", () => {
    expect(
      parseAllMangaEpisodeNumber({
        index: 1,
        label: "Episode 12",
        detail: "12",
      }),
    ).toBe(12);
  });

  test("mergeMiruroPipeEpisodeMetadata captures stills and enrich prefers longer titles", () => {
    const metadata = new Map<number, import("../src/shared/anime-metadata").AnimeEpisodeMetadata>();
    mergeMiruroPipeEpisodeMetadata(metadata, [
      {
        number: 1,
        title: "I'm Luffy!",
        description: "Short synopsis",
        image: "https://image.tmdb.org/t/p/original/still.jpg",
      },
    ]);
    mergeMiruroPipeEpisodeMetadata(metadata, []);
    metadata.set(1, {
      number: 1,
      title: "I'm Luffy! The Man Who Will Become the Pirate King!",
      thumbnail: metadata.get(1)?.thumbnail,
      synopsis: metadata.get(1)?.synopsis,
      source: "merged",
    });

    const enriched = enrichEpisodeOptionsWithAnimeMetadata(
      [{ index: 1, label: "Episode 1" }],
      metadata,
      (episode) => episode.index,
    );
    expect(enriched[0]?.name).toBe("I'm Luffy! The Man Who Will Become the Pirate King!");
    expect(enriched[0]?.artwork?.thumbnailUrl).toBe(
      "https://image.tmdb.org/t/p/original/still.jpg",
    );
    expect(metadata.get(1)?.thumbnail).toBe("https://image.tmdb.org/t/p/original/still.jpg");
  });

  test("seedEpisodeMetadataFromProvider round-trips through getSeededEpisodeMetadata", () => {
    const key = allMangaEpisodeMetadataCacheKey("show-abc", "sub");
    seedEpisodeMetadataFromProvider(key, [
      { number: 1, title: "The Beginning", source: "allmanga" },
      { number: 2, title: "Next Step", source: "allmanga" },
    ]);

    const seeded = getSeededEpisodeMetadata(key);
    expect(seeded?.get(1)?.title).toBe("The Beginning");
    expect(seeded?.get(2)?.title).toBe("Next Step");
  });

  test("shouldSkipExternalEpisodeMetadataEnrichment gates at 80% titled episodes", () => {
    const metadata = new Map<number, AnimeEpisodeMetadata>();
    for (let number = 1; number <= 10; number += 1) {
      metadata.set(number, {
        number,
        title: number <= 8 ? `Episode ${number} title` : undefined,
        source: "miruro",
      });
    }

    expect(episodeMetadataTitleCoverage(metadata, 10)).toBe(0.8);
    expect(shouldSkipExternalEpisodeMetadataEnrichment(metadata, 10)).toBe(true);
    expect(shouldSkipExternalEpisodeMetadataEnrichment(metadata, 11)).toBe(false);
  });

  test("pipeEpisodeMetadataTitleCoverage measures pipe entry title density", () => {
    expect(
      pipeEpisodeMetadataTitleCoverage([
        { number: 1, title: "Pilot" },
        { number: 2, title: "Departure" },
        { number: 3 },
      ]),
    ).toBeCloseTo(2 / 3);
  });
});
