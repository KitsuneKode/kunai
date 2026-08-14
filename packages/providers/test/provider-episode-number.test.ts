import { describe, expect, test } from "bun:test";

import { selectProviderEpisodeNumber } from "../src/shared/provider-episode-number";

describe("provider episode-number routing", () => {
  test("prefers a proven season-relative episode over absolute numbering", () => {
    expect(selectProviderEpisodeNumber({ season: 2, episode: 1, absoluteEpisode: 13 })).toBe(1);
  });

  test("uses absolute numbering for an absolute-only request", () => {
    expect(selectProviderEpisodeNumber({ absoluteEpisode: 13 })).toBe(13);
  });

  test("keeps the existing episode-one default when identity is missing", () => {
    expect(selectProviderEpisodeNumber(undefined)).toBe(1);
    expect(selectProviderEpisodeNumber({})).toBe(1);
  });
});
