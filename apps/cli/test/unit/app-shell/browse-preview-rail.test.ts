import { describe, expect, test } from "bun:test";

import {
  browseResultStatusLine,
  buildPreviewRailModelFromBrowseOption,
  filterBrowseOptionsByResultFilter,
} from "@/app-shell/browse-preview-rail";
import type { BrowseShellOption } from "@/app-shell/types";

describe("buildPreviewRailModelFromBrowseOption", () => {
  test("uses title weight and omits provider-only facts from the rail", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Demon Slayer (2019)",
      previewTitle: "Demon Slayer",
      previewMeta: ["Series", "2019"],
      previewBadge: "resume",
      previewBody: "A young swordsman joins the demon slayer corps.",
      previewNote: "Press Enter to open this title.",
      previewFacts: [
        { label: "Local progress", detail: "S01E03 · 40%", tone: "warning" },
        { label: "Metadata source", detail: "provider response", tone: "neutral" },
      ],
    };

    const model = buildPreviewRailModelFromBrowseOption(option, "none");
    expect(model?.title).toBe("Demon Slayer");
    expect(model?.subtitle).toContain("2019");
    expect(model?.facts.some((fact) => fact.label === "Metadata source")).toBe(false);
    expect(model?.facts.find((fact) => fact.label === "Progress")?.value).toBe("S01E03 · 40%");
    expect(model?.facts.find((fact) => fact.label === "Open")?.value).toBe("Enter · open");
  });

  test("shortens aliases and drops unknown audio placeholders", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Demo",
      previewTitle: "Demo",
      previewFacts: [
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
      ],
    };

    const model = buildPreviewRailModelFromBrowseOption(option, "none");
    expect(model?.facts).toEqual([
      {
        label: "Aliases",
        value: "Kimetsu no Yaiba · 鬼滅の刃",
        tone: "success",
      },
    ]);
  });
});

describe("browseResultStatusLine", () => {
  test("keeps subtitle as the single count line when not filtering", () => {
    expect(
      browseResultStatusLine({
        resultSubtitle: "6 results · AllAnime",
        resultFilter: "",
        displayCount: 6,
        totalCount: 6,
      }),
    ).toEqual({ primary: "6 results · AllAnime" });
  });

  test("shows a filtered count on the right without repeating the headline count", () => {
    expect(
      browseResultStatusLine({
        resultSubtitle: "6 results · AllAnime",
        resultFilter: "demon",
        displayCount: 2,
        totalCount: 6,
      }),
    ).toEqual({
      primary: "6 results · AllAnime",
      secondary: "2 of 6 shown",
    });
  });
});

describe("filterBrowseOptionsByResultFilter", () => {
  test("narrows visible rows without mutating the source list", () => {
    const options: BrowseShellOption<string>[] = [
      { value: "1", label: "Frieren", previewTitle: "Frieren" },
      { value: "2", label: "Chainsaw Man", previewTitle: "Chainsaw Man" },
    ];
    const filtered = filterBrowseOptionsByResultFilter(options, "frieren");
    expect(filtered).toHaveLength(1);
    expect(options).toHaveLength(2);
  });
});
