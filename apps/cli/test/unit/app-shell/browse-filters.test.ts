import { describe, expect, test } from "bun:test";

import {
  applyBrowseResultFilters,
  clearBrowseResultFilter,
  describeBrowseResultFilters,
  parseBrowseFilterQuery,
} from "@/app-shell/browse-filters";
import type { BrowseShellOption } from "@/app-shell/types";

const OPTIONS: readonly BrowseShellOption<string>[] = [
  {
    value: "breaking-bad",
    label: "Breaking Bad",
    previewMeta: ["Series", "2008"],
    previewRating: "9.5/10 TMDB",
  },
  {
    value: "el-camino",
    label: "El Camino",
    previewMeta: ["Movie", "2019"],
    previewRating: "7.3/10 TMDB",
  },
  {
    value: "better-call-saul",
    label: "Better Call Saul",
    previewMeta: ["Series", "2015"],
    previewRating: "9.0/10 TMDB",
  },
  {
    value: "solo-leveling",
    label: "Solo Leveling",
    detail: "Series · downloaded · release today",
    previewMeta: ["Series", "2024", "downloaded", "release today"],
    previewFacts: [
      { label: "Offline", detail: "downloaded", tone: "success" },
      { label: "Local progress", detail: "continue S01E04 · 12:00", tone: "warning" },
      { label: "Metadata source", detail: "allanime search", tone: "success" },
    ],
  },
  {
    value: "frieren",
    label: "Frieren",
    detail: "Series · watched · release upcoming",
    previewMeta: ["Series", "2023", "watched", "release upcoming"],
    previewFacts: [
      { label: "Local progress", detail: "watched", tone: "success" },
      { label: "Metadata source", detail: "anilist trending", tone: "success" },
    ],
  },
];

describe("browse filters", () => {
  test("strips supported filter tokens while preserving the provider search query", () => {
    const parsed = parseBrowseFilterQuery("breaking bad type:series year:2008 rating:9");

    expect(parsed.searchQuery).toBe("breaking bad");
    expect(parsed.filters).toMatchObject({
      type: "series",
      year: "2008",
      minRating: 9,
    });
  });

  test("keeps plain words that look like media types unless they use token syntax", () => {
    const parsed = parseBrowseFilterQuery("the series");

    expect(parsed.searchQuery).toBe("the series");
    expect(parsed.filters.type).toBe("all");
  });

  test("filters browse options locally without extra provider calls", () => {
    const parsed = parseBrowseFilterQuery("bad type:series rating:9 year:2008");
    const filtered = applyBrowseResultFilters(OPTIONS, parsed.filters);

    expect(filtered.map((option) => option.value)).toEqual(["breaking-bad"]);
    expect(describeBrowseResultFilters(parsed.filters)).toEqual([
      "type series",
      "year 2008",
      "rating >= 9",
    ]);
  });

  test("parses advanced intent filters as local badges without changing provider query", () => {
    const parsed = parseBrowseFilterQuery(
      "solo leveling mode:anime genre:action downloaded:true watched:watching release:this-week sort:recent",
    );

    expect(parsed.searchQuery).toBe("solo leveling");
    expect(parsed.filters).toMatchObject({
      type: "all",
      genres: ["action"],
      downloaded: true,
      watched: "watching",
      release: "this-week",
      sort: "recent",
      mode: "anime",
    });
    expect(describeBrowseResultFilters(parsed.filters)).toEqual([
      "mode anime",
      "genre action",
      "downloaded true",
      "watched watching",
      "release this-week",
      "sort recent",
    ]);
  });

  test("filters loaded results by cached local facts without provider calls", () => {
    expect(
      applyBrowseResultFilters(OPTIONS, parseBrowseFilterQuery("downloaded:true").filters).map(
        (option) => option.value,
      ),
    ).toEqual(["solo-leveling"]);

    expect(
      applyBrowseResultFilters(OPTIONS, parseBrowseFilterQuery("watched:watching").filters).map(
        (option) => option.value,
      ),
    ).toEqual(["solo-leveling"]);

    expect(
      applyBrowseResultFilters(OPTIONS, parseBrowseFilterQuery("watched:completed").filters).map(
        (option) => option.value,
      ),
    ).toEqual(["frieren"]);

    expect(
      applyBrowseResultFilters(OPTIONS, parseBrowseFilterQuery("release:today").filters).map(
        (option) => option.value,
      ),
    ).toEqual(["solo-leveling"]);

    expect(
      applyBrowseResultFilters(OPTIONS, parseBrowseFilterQuery("provider:allanime").filters).map(
        (option) => option.value,
      ),
    ).toEqual(["solo-leveling"]);
  });

  test("clears one active browse chip without dropping the rest", () => {
    const parsed = parseBrowseFilterQuery("isekai type:series year:2024 rating:8 genre:action");

    const withoutYear = clearBrowseResultFilter(parsed.filters, "year");

    expect(withoutYear.year).toBeUndefined();
    expect(describeBrowseResultFilters(withoutYear)).toEqual([
      "type series",
      "genre action",
      "rating >= 8",
    ]);
    expect(applyBrowseResultFilters(OPTIONS, withoutYear).map((option) => option.value)).toEqual([
      "breaking-bad",
      "better-call-saul",
    ]);
  });
});
