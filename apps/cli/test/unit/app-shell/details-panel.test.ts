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
    expect(panel.badges.map((badge) => badge.label)).toEqual(["Series", "2019", "8.5/10 TMDB"]);
    expect(panel.badges.find((badge) => badge.label === "8.5/10 TMDB")?.tone).toBe("success");
    expect(panel.facts.map((fact) => fact.label)).toEqual([
      "Type",
      "Year",
      "Rating",
      "Poster",
      "Next step",
    ]);
    expect(panel.facts.find((fact) => fact.label === "Poster")?.tone).toBe("success");
  });
});
