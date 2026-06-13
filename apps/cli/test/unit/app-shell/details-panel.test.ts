import { describe, expect, test } from "bun:test";

import {
  buildBrowseDetailsPanel,
  buildDetailsPanelDataFromBrowseOption,
  resolveBrowseDetailsSecondary,
} from "@/app-shell/details-panel";
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

    expect(panel.title).toBe("Media dossier");
    expect(panel.subtitle).toBe("Demon Slayer");
    expect(panel.imageUrl).toBe("https://image.tmdb.org/t/p/w342/demo.jpg");
    // Compact model: first line is the title; type/year/rating fold into one
    // "At a glance" line rather than separate duplicated facts.
    expect(panel.lines[0]).toEqual({ label: "Title", detail: "Demon Slayer", tone: "success" });
    expect(panel.lines.find((line) => line.label === "At a glance")?.detail).toContain(
      "8.5/10 TMDB",
    );
    expect(panel.lines.find((line) => line.label === "Type")).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Artwork")).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Open")).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Series actions")?.detail).toContain(
      "/follow releases",
    );
  });

  test("uses explicit placeholders when providers omit details", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Provider-only title",
    };

    const panel = buildBrowseDetailsPanel(option);

    expect(panel.imageUrl).toBeUndefined();
    // No fabricated Artwork/Rating placeholder rows in the compact model.
    expect(panel.lines.find((line) => line.label === "Artwork")).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Rating")).toBeUndefined();
    expect(panel.lines.find((line) => line.label === "Overview")?.detail).toBe(
      "No overview available yet.",
    );
  });

  test("promotes local progress and offline state in title details", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Anime Demo",
      previewTitle: "Anime Demo",
      previewMeta: ["Series", "2026", "continue S02E07 · 30:00 (50%)", "downloaded"],
      previewFacts: [
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
      ],
    };

    const panel = buildBrowseDetailsPanel(option);

    expect(panel.lines).toEqual(
      expect.arrayContaining([
        { label: "─── Local", detail: "", tone: "info" },
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
      ]),
    );
  });

  test("groups release and history facts into a watching section", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Weekly Anime",
      previewTitle: "Weekly Anime",
      previewMeta: ["Series", "2026"],
      previewFacts: [
        { label: "Release", detail: "3 new for you", tone: "success" },
        { label: "Watch history", detail: "Watched · S01E05", tone: "success" },
        { label: "Metadata source", detail: "AniList calendar", tone: "success" },
      ],
    };

    const panel = buildBrowseDetailsPanel(option);

    expect(panel.lines).toEqual(
      expect.arrayContaining([
        { label: "─── Watching", detail: "", tone: "info" },
        { label: "Release", detail: "3 new for you", tone: "success" },
        { label: "Watch history", detail: "Watched · S01E05", tone: "success" },
      ]),
    );
    expect(panel.lines.find((line) => line.label === "─── Details")).toBeDefined();
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

    const panel = buildDetailsPanelDataFromBrowseOption(option);
    const secondary = resolveBrowseDetailsSecondary(option);

    expect(panel.primary.title).toBe("Demon Slayer");
    expect(panel.primary.year).toBe("2019");
    expect(secondary.providers).toBeUndefined();
  });

  test("keeps missing companion artwork honest without surfacing debug state", () => {
    const option: BrowseShellOption<string> = {
      value: "demo",
      label: "Provider-only title",
      previewMeta: ["Movie", "2024"],
    };

    const panel = buildDetailsPanelDataFromBrowseOption(option);

    expect(panel.primary.type).toBe("movie");
    expect(panel.primary.year).toBe("2024");
  });
});
