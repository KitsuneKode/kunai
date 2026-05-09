import { describe, expect, test } from "bun:test";

import { buildBrowseCompanionPanel, buildBrowseDetailsPanel } from "@/app-shell/details-panel";
import type { BrowseShellOption } from "@/app-shell/types";

describe("buildBrowseDetailsPanel", () => {
  test("surfaces image and rating data when available", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Demon Slayer",
      previewTitle: "Demon Slayer",
      previewBody: "A young swordsman joins the demon slayer corps.",
      previewImageUrl: "https://image.tmdb.org/t/p/w342/demo.jpg",
      previewRating: "8.5/10 TMDB",
      previewMeta: ["Series", "2019", "26 episodes"],
    };

    const panel = buildBrowseDetailsPanel(option);

    expect(panel.title).toBe("Title overview");
    expect(panel.subtitle).toBe("Demon Slayer");
    expect(panel.imageUrl).toBe("https://image.tmdb.org/t/p/w342/demo.jpg");
    expect(panel.lines.find((line) => line.label === "Artwork")?.tone).toBe("success");
    expect(panel.lines.find((line) => line.label === "Trailer")?.detail).toBe(
      "Trailer links are not part of the current search contract yet.",
    );
    expect(panel.lines.find((line) => line.label === "Rating")?.detail).toBe("8.5/10 TMDB");
  });

  test("uses explicit placeholders when providers omit details", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Provider-only title",
    };

    const panel = buildBrowseDetailsPanel(option);

    expect(panel.imageUrl).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Artwork")?.tone).toBe("warning");
    expect(panel.lines.find((line) => line.label === "Rating")?.detail).toBe(
      "Rating unavailable from this provider response",
    );
  });

  test("builds compact companion facts for the selected browse result", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Demon Slayer (2019)",
      previewTitle: "Demon Slayer",
      previewBody: "A young swordsman joins the demon slayer corps.",
      previewImageUrl: "https://image.tmdb.org/t/p/w342/demo.jpg",
      previewRating: "8.5/10 TMDB",
      previewMeta: ["Series", "2019", "8.5/10 TMDB"],
      previewNote: "Press Enter to open this title.",
    };

    const panel = buildBrowseCompanionPanel(option, {
      selectedDetail: "Series · A young swordsman joins the demon slayer corps.",
    });

    expect(panel.title).toBe("Demon Slayer");
    expect(panel.metaLine).toBe("2019  ·  Series  ·  8.5/10 TMDB");
    expect(panel.facts).toEqual([]);
  });

  test("keeps missing companion artwork honest without surfacing debug state", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Provider-only title",
      previewMeta: ["Movie", "2024"],
    };

    const panel = buildBrowseCompanionPanel(option, {
      selectedDetail: "Movie",
    });

    expect(panel.metaLine).toBe("2024  ·  Movie");
    expect(panel.facts).toEqual([
      {
        label: "Artwork",
        detail: "Not supplied by this provider",
        tone: "neutral",
      },
    ]);
  });
});
