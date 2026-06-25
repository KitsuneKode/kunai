import { expect, test } from "bun:test";

import { providerMetadataMatchesLane } from "@/domain/provider-lane";

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
