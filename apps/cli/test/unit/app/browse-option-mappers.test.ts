import { describe, expect, test } from "bun:test";

import { toBrowseResultOption } from "@/app/browse-option-mappers";
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
});
