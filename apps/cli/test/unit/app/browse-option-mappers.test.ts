import { describe, expect, test } from "bun:test";

import { chooseSearchResultTitle, toBrowseResultOption } from "@/app/browse-option-mappers";
import type { SearchResult } from "@/domain/types";

describe("toBrowseResultOption", () => {
  test("maps a series result into a details-first browse option", () => {
    const result: SearchResult = {
      id: "demo",
      type: "series",
      title: "Demon Slayer",
      year: "2019",
      overview: "A young swordsman joins the demon slayer corps.",
      posterPath: "/demo.jpg",
      rating: 8.5,
      popularity: 123,
      episodeCount: 26,
    };

    expect(toBrowseResultOption(result)).toEqual({
      value: result,
      label: "Demon Slayer (2019)",
      detail: "Series · A young swordsman joins the demon slayer corps.",
      previewTitle: "Demon Slayer",
      previewMeta: ["Series", "2019", "26 episodes", "8.5/10 TMDB"],
      previewFacts: [
        {
          label: "Metadata source",
          detail: "provider response",
          tone: "neutral",
        },
        {
          label: "Title aliases",
          detail: "No alternate title aliases returned",
          tone: "neutral",
        },
        {
          label: "Audio and subtitles",
          detail:
            "audio availability unknown until resolve  ·  subtitle availability unknown until resolve",
          tone: "neutral",
        },
        {
          label: "Provider detail page",
          detail: "Overview available",
          tone: "success",
        },
        {
          label: "Image source",
          detail: "Poster URL available",
          tone: "success",
        },
        {
          label: "Popularity",
          detail: "123",
          tone: "neutral",
        },
      ],
      previewImageUrl: "https://image.tmdb.org/t/p/w342/demo.jpg",
      previewRating: "8.5/10 TMDB",
      previewBody: "A young swordsman joins the demon slayer corps.",
      previewNote:
        "Press Enter to open this title and continue to episode selection. Use / details for the overview.",
    });
  });

  test("prefers configured anime title aliases without losing provider title context", () => {
    const result: SearchResult = {
      id: "anime-demo",
      type: "series",
      title: "Kimetsu no Yaiba",
      titleAliases: [
        { kind: "provider", value: "Kimetsu no Yaiba" },
        { kind: "english", value: "Demon Slayer" },
        { kind: "native", value: "鬼滅の刃" },
      ],
      year: "2019",
      overview: "",
      posterPath: "https://img.example/demon.jpg",
      posterSource: "AniList",
      metadataSource: "AniList",
    };

    expect(chooseSearchResultTitle(result, "english")).toBe("Demon Slayer");
    expect(toBrowseResultOption(result, null, "english")).toMatchObject({
      label: "Demon Slayer (2019)",
      previewTitle: "Demon Slayer",
      previewImageUrl: "https://img.example/demon.jpg",
      previewFacts: [
        { label: "Metadata source", detail: "AniList", tone: "success" },
        {
          label: "Title aliases",
          detail: "provider: Kimetsu no Yaiba  ·  native: 鬼滅の刃",
          tone: "success",
        },
        {
          label: "Audio and subtitles",
          detail:
            "audio availability unknown until resolve  ·  subtitle availability unknown until resolve",
          tone: "neutral",
        },
        {
          label: "Provider detail page",
          detail: "Provider did not return overview text",
          tone: "warning",
        },
        { label: "Image source", detail: "Poster URL available from AniList", tone: "success" },
      ],
    });
  });

  test("shows provider search audio and hardsub availability only when it has evidence", () => {
    const result: SearchResult = {
      id: "anime-demo",
      type: "series",
      title: "Anime Demo",
      year: "",
      overview: "",
      posterPath: null,
      availableAudioModes: ["sub", "dub"],
      subtitleAvailability: "hardsub",
    };

    const option = toBrowseResultOption(result);

    expect(option.previewMeta).toContain("sub/dub audio · hardsub available");
    expect(option.previewFacts?.find((fact) => fact.label === "Audio and subtitles")).toMatchObject(
      {
        detail: "sub/dub audio available  ·  hardsub evidence from provider search",
        tone: "success",
      },
    );
  });

  test("adds local progress and offline enrichment without hiding provider facts", () => {
    const result: SearchResult = {
      id: "anime-demo",
      type: "series",
      title: "Anime Demo",
      year: "2026",
      overview: "A strange club keeps solving stranger mysteries.",
      posterPath: null,
      metadataSource: "AniList",
    };

    const option = toBrowseResultOption(result, null, "provider", {
      badges: [
        { label: "continue S02E07 · 30:00 (50%)", tone: "warning" },
        { label: "downloaded", tone: "success" },
      ],
    });

    expect(option.detail).toContain("continue S02E07 · 30:00 (50%)");
    expect(option.previewMeta).toContain("continue S02E07 · 30:00 (50%)");
    expect(option.previewMeta).toContain("downloaded");
    expect(option.previewFacts).toEqual(
      expect.arrayContaining([
        {
          label: "Local progress",
          detail: "continue S02E07 · 30:00 (50%)",
          tone: "warning",
        },
        {
          label: "Offline",
          detail: "downloaded",
          tone: "success",
        },
        {
          label: "Metadata source",
          detail: "AniList",
          tone: "success",
        },
      ]),
    );
  });
});
