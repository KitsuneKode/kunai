import { expect, test } from "bun:test";

import {
  resolveTitleLaneEligibility,
  resolveTitleProviderLane,
  titleMatchesShellMode,
} from "@/domain/provider-lane-contract";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";

test("classifies YouTube identities as the YouTube provider lane", () => {
  expect(
    resolveTitleProviderLane({
      id: "youtube:dQw4w9WgXcQ",
    }),
  ).toBe("youtube");
});

test("rejects YouTube identities outside YouTube mode", () => {
  const title = {
    id: "youtube:dQw4w9WgXcQ",
  };

  expect(titleMatchesShellMode(title, "youtube")).toBe(true);
  expect(titleMatchesShellMode(title, "series")).toBe(false);
  expect(titleMatchesShellMode(title, "anime")).toBe(false);
});

test("classifies explicit anime titles as the anime provider lane", () => {
  expect(resolveTitleProviderLane({ id: "anilist:1", isAnime: true })).toBe("anime");
});

test("allows unclassified provider-native titles through anime mode", () => {
  expect(
    titleMatchesShellMode(
      {
        id: "SJms742bSTrcyJZay",
      },
      "anime",
    ),
  ).toBe(true);
});

test("allows anime titles with a TMDB id through series mode (dual-lane)", () => {
  const linkedAnime = {
    id: "1535",
    isAnime: true,
    externalIds: { anilistId: "1535", tmdbId: "13916" },
  };
  expect(titleMatchesShellMode(linkedAnime, "series")).toBe(true);
  expect(titleMatchesShellMode(linkedAnime, "anime")).toBe(true);
});

test("still rejects anime titles without a TMDB id in series mode", () => {
  const animeOnly = {
    id: "1535",
    isAnime: true,
    externalIds: { anilistId: "1535" },
  };
  expect(titleMatchesShellMode(animeOnly, "series")).toBe(false);
});

test("resolveTitleLaneEligibility reports both lanes for a linked anime", () => {
  expect(
    resolveTitleLaneEligibility({
      id: "1535",
      isAnime: true,
      externalIds: { anilistId: "1535", tmdbId: "13916" },
    }),
  ).toEqual({ anime: true, series: true, youtube: false });

  expect(
    resolveTitleLaneEligibility({
      id: "tmdb:1396",
      externalIds: { tmdbId: "1396" },
    }),
  ).toEqual({ anime: false, series: true, youtube: false });

  expect(
    resolveTitleLaneEligibility({
      id: "youtube:abc",
    }),
  ).toEqual({ anime: false, series: false, youtube: true });
});

test("refuses to construct a series resolve request for a YouTube title", () => {
  expect(() =>
    streamRequestToResolveInput(
      {
        title: { id: "youtube:dQw4w9WgXcQ", type: "series", name: "Demo" },
        audioPreference: "original",
        subtitlePreference: "none",
      },
      "series",
    ),
  ).toThrow("youtube lane");
});
