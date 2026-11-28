import { describe, expect, test } from "bun:test";

import type { HomeCommandMetadata, HomeProviderMetadata } from "../components/home/types";
import {
  countProvidersByLane,
  filterCommands,
  filterProviders,
  providerLane,
  sieveMatch,
} from "../lib/provider-sieve";

const FIXTURE_PROVIDERS: readonly HomeProviderMetadata[] = [
  {
    id: "vidlink",
    displayName: "VidLink",
    description: "Movies and series with multi-language subtitles",
    domain: "vidlink.pro",
    recommended: true,
    mediaKinds: ["movie", "series"],
    capabilities: ["source-resolve", "subtitle-resolve", "quality-ranked"],
    notes: [],
  },
  {
    id: "videasy",
    displayName: "Videasy",
    description: "Registered movies/series adapter",
    domain: "videasy.to",
    recommended: false,
    mediaKinds: ["movie", "series"],
    capabilities: ["source-resolve", "multi-source"],
    notes: [],
  },
  {
    id: "hianime",
    displayName: "HiAnime",
    description: "Anime episodes in sub and dub",
    domain: "hianime.at",
    recommended: true,
    mediaKinds: ["anime"],
    capabilities: ["search", "episode-list", "source-resolve"],
    notes: [],
  },
  {
    id: "allanime",
    displayName: "AllManga",
    description: "Anime episodes in sub and dub",
    domain: "mkissa.to",
    recommended: false,
    mediaKinds: ["anime"],
    capabilities: ["search", "episode-list"],
    notes: [],
  },
  {
    id: "youtube",
    displayName: "YouTube",
    description: "Videos and music streams",
    domain: "youtube.com",
    recommended: true,
    mediaKinds: ["video"],
    capabilities: ["search", "source-resolve", "quality-ranked"],
    notes: [],
  },
];

const FIXTURE_COMMANDS: readonly HomeCommandMetadata[] = [
  { id: "search", label: "Search", aliases: ["s"], description: "Search titles across modes" },
  { id: "recover", label: "Recover", aliases: ["r"], description: "Re-resolve stalled playback" },
  {
    id: "fallback",
    label: "Fallback",
    aliases: ["f"],
    description: "Switch to the next working provider",
  },
  {
    id: "calendar",
    label: "Calendar",
    aliases: ["cal"],
    description: "Upcoming airing episodes",
  },
];

describe("provider-sieve", () => {
  test("classifies lanes from declared mediaKinds without hardcoding ids", () => {
    expect(providerLane(FIXTURE_PROVIDERS[0]!)).toBe("series");
    expect(providerLane(FIXTURE_PROVIDERS[2]!)).toBe("anime");
    expect(providerLane(FIXTURE_PROVIDERS[4]!)).toBe("youtube");

    expect(countProvidersByLane(FIXTURE_PROVIDERS)).toEqual({
      anime: { total: 2, recommended: 1 },
      series: { total: 2, recommended: 1 },
      youtube: { total: 1, recommended: 1 },
    });
  });

  test("returns contiguous highlight ranges and ranks tighter prefix hits higher", () => {
    const exact = sieveMatch("VidLink", "vidl");
    const sparse = sieveMatch("Videasy", "vidl");
    expect(sparse).toBeNull();
    expect(exact).not.toBeNull();
    expect(exact?.ranges).toEqual([[0, 4]]);

    const split = sieveMatch("HiAnime", "ham");
    expect(split).not.toBeNull();
    expect(split?.ranges).toEqual([
      [0, 1],
      [2, 3],
      [5, 6],
    ]);

    const prefix = sieveMatch("AllManga", "all");
    const middle = sieveMatch("InstallAll", "all");
    expect(prefix!.score).toBeGreaterThan(middle!.score);
  });

  test("places recommended providers first when query is empty and filters by lane", () => {
    const all = filterProviders(FIXTURE_PROVIDERS, "", "all");
    expect(all.slice(0, 3).every((entry) => entry.provider.recommended)).toBe(true);

    const animeOnly = filterProviders(FIXTURE_PROVIDERS, "", "anime");
    expect(animeOnly.map((entry) => entry.provider.id)).toEqual(["hianime", "allanime"]);
  });

  test("matches providers across displayName, domain and capabilities", () => {
    const byDomain = filterProviders(FIXTURE_PROVIDERS, "mkissa");
    expect(byDomain.map((entry) => entry.provider.id)).toEqual(["allanime"]);
    expect(byDomain[0]?.domainRanges).toEqual([[0, 6]]);

    const byCap = filterProviders(FIXTURE_PROVIDERS, "subtitle");
    expect(byCap.map((entry) => entry.provider.id)).toEqual(["vidlink"]);
  });

  test("strips leading slash and ranks command ids above description matches", () => {
    const hits = filterCommands(FIXTURE_COMMANDS, "/rec");
    expect(hits[0]?.command.id).toBe("recover");
    expect(hits[0]?.idRanges).toEqual([[0, 3]]);

    const byAlias = filterCommands(FIXTURE_COMMANDS, "cal");
    expect(byAlias[0]?.command.id).toBe("calendar");
  });
});
