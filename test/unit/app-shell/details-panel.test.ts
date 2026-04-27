import { describe, expect, test } from "bun:test";

import { buildBrowseDetailsPanel } from "@/app-shell/details-panel";
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
    expect(panel.lines.find((line) => line.label === "Poster preview")?.tone).toBe("success");
    expect(panel.lines.find((line) => line.label === "Rating")?.detail).toBe("8.5/10 TMDB");
  });

  test("uses explicit placeholders when providers omit details", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Provider-only title",
    };

    const panel = buildBrowseDetailsPanel(option);

    expect(panel.imageUrl).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Poster preview")?.tone).toBe("warning");
    expect(panel.lines.find((line) => line.label === "Rating")?.detail).toBe(
      "Rating unavailable from this provider response",
    );
  });
});
