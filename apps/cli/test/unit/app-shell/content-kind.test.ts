import { expect, test } from "bun:test";

import {
  mediaLanguageProfileFor,
  resolveContentKind,
  showsEpisodeLabel,
} from "@/app-shell/content-kind";

test("movie content type wins over mode (never renders as series)", () => {
  expect(resolveContentKind({ type: "movie" }, "series")).toBe("movie");
  expect(resolveContentKind({ type: "movie" }, "anime")).toBe("movie");
});

test("anime mode renders anime for non-movie titles", () => {
  expect(resolveContentKind({ type: "series" }, "anime")).toBe("anime");
});

test("series is the default for non-movie, non-anime", () => {
  expect(resolveContentKind({ type: "series" }, "series")).toBe("series");
  expect(resolveContentKind(null, "series")).toBe("series");
});

test("episode label is hidden for movies, shown otherwise", () => {
  expect(showsEpisodeLabel({ type: "movie" })).toBe(false);
  expect(showsEpisodeLabel({ type: "series" })).toBe(true);
  expect(showsEpisodeLabel(null)).toBe(true);
});

test("mediaLanguageProfileFor picks the profile matching content kind (movie not series)", () => {
  const profiles = {
    animeLanguageProfile: { audio: "ja", subtitle: "en", quality: "1080p" },
    seriesLanguageProfile: { audio: "en", subtitle: "en", quality: "1080p" },
    movieLanguageProfile: { audio: "en", subtitle: "off", quality: "best" },
  } as const;
  expect(
    mediaLanguageProfileFor({ mode: "series", currentTitle: { type: "movie" }, ...profiles }),
  ).toBe(profiles.movieLanguageProfile);
  expect(
    mediaLanguageProfileFor({ mode: "anime", currentTitle: { type: "series" }, ...profiles }),
  ).toBe(profiles.animeLanguageProfile);
  expect(
    mediaLanguageProfileFor({ mode: "series", currentTitle: { type: "series" }, ...profiles }),
  ).toBe(profiles.seriesLanguageProfile);
});
