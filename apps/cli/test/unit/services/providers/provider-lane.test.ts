import { expect, test } from "bun:test";

import { providerMetadataMatchesLane, providerPickerLanesForTitle } from "@/domain/provider-lane";

test("providerMetadataMatchesLane filters youtube providers in youtube lane", () => {
  expect(
    providerMetadataMatchesLane({ isAnimeProvider: false, isYoutubeProvider: true }, "youtube"),
  ).toBe(true);
  expect(
    providerMetadataMatchesLane({ isAnimeProvider: false, isYoutubeProvider: false }, "youtube"),
  ).toBe(false);
  expect(
    providerMetadataMatchesLane({ isAnimeProvider: true, isYoutubeProvider: false }, "anime"),
  ).toBe(true);
  expect(
    providerMetadataMatchesLane({ isAnimeProvider: false, isYoutubeProvider: false }, "series"),
  ).toBe(true);
});

test("providerPickerLanesForTitle adds the series lane for linked anime", () => {
  expect(
    providerPickerLanesForTitle("anime", { anime: true, series: true, youtube: false }),
  ).toEqual(["anime", "series"]);
  expect(
    providerPickerLanesForTitle("series", { anime: true, series: true, youtube: false }),
  ).toEqual(["series", "anime"]);
});

test("providerPickerLanesForTitle stays single-lane without linked ids", () => {
  expect(
    providerPickerLanesForTitle("anime", { anime: true, series: false, youtube: false }),
  ).toEqual(["anime"]);
  expect(providerPickerLanesForTitle("series", null)).toEqual(["series"]);
  expect(
    providerPickerLanesForTitle("youtube", { anime: true, series: true, youtube: false }),
  ).toEqual(["youtube"]);
  expect(
    providerPickerLanesForTitle("series", { anime: false, series: false, youtube: true }),
  ).toEqual(["series"]);
});
