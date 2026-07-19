import { describe, expect, test } from "bun:test";

import { resolveBrowseDestinationLabel } from "@/app-shell/browse-destination";

describe("resolveBrowseDestinationLabel", () => {
  test("prefers Search when the query box has text", () => {
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "Breaking Bad",
        resultSubtitle: "12 trending · TMDB",
        hasResults: true,
        searchState: "ready",
      }),
    ).toBe("Search");
  });

  test("maps discovery subtitles to Trending / Recommendations / Surprise / Random", () => {
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "",
        resultSubtitle: "12 trending · TMDB",
        hasResults: true,
        searchState: "ready",
      }),
    ).toBe("Trending");
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "",
        resultSubtitle: "8 recommendation picks · loaded",
        hasResults: true,
        searchState: "ready",
      }),
    ).toBe("Recommendations");
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "",
        resultSubtitle: "1 surprise pick · /surprise to spin again",
        hasResults: true,
        searchState: "ready",
      }),
    ).toBe("Surprise");
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "",
        resultSubtitle: "6 random picks · /random to reshuffle",
        hasResults: true,
        searchState: "ready",
      }),
    ).toBe("Random");
  });

  test("uses loading emptyMessage hints before results land", () => {
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "",
        resultSubtitle: "",
        emptyMessage: "Loading recommendations…",
        hasResults: false,
        searchState: "loading",
      }),
    ).toBe("Recommendations");
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: false,
        query: "",
        resultSubtitle: "",
        emptyMessage: "Loading trending…",
        hasResults: false,
        searchState: "loading",
      }),
    ).toBe("Trending");
  });

  test("calendar wins over other signals", () => {
    expect(
      resolveBrowseDestinationLabel({
        isCalendar: true,
        query: "ignored",
        resultSubtitle: "12 trending · TMDB",
        hasResults: true,
        searchState: "ready",
      }),
    ).toBe("Schedule");
  });
});
