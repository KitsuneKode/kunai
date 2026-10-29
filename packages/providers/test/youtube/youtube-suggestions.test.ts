import { describe, expect, test } from "bun:test";

import {
  fetchGoogleYoutubeSuggestions,
  fetchYoutubeSearchSuggestions,
} from "../../src/youtube/youtube-suggestions";

describe("YouTube search suggestions", () => {
  test("returns empty array for empty query", async () => {
    expect(await fetchGoogleYoutubeSuggestions("")).toEqual([]);
    expect(await fetchGoogleYoutubeSuggestions("   ")).toEqual([]);
    expect(await fetchYoutubeSearchSuggestions("")).toEqual([]);
  });

  test("fetches real query completions from Google suggestion endpoint", async () => {
    const suggestions = await fetchGoogleYoutubeSuggestions("lofi");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.toLowerCase().includes("lofi"))).toBe(true);
  });

  test("fetchYoutubeSearchSuggestions returns completions", async () => {
    const suggestions = await fetchYoutubeSearchSuggestions("anime");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.toLowerCase().includes("anime"))).toBe(true);
  });
});
