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
      posterPath: null,
      episodeCount: 26,
    };

    expect(toBrowseResultOption(result)).toEqual({
      value: result,
      label: "Demon Slayer (2019)",
      detail: "Series · A young swordsman joins the demon slayer corps.",
      previewTitle: "Demon Slayer",
      previewMeta: ["Series", "2019", "26 episodes"],
      previewBody: "A young swordsman joins the demon slayer corps.",
      previewNote: "Press Enter once for details, then Enter again to start episode selection.",
    });
  });
});
