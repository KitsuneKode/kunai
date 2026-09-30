import { describe, expect, it } from "bun:test";

import { DetailsSheetUI } from "@/app-shell/details-pane-ui";
import type { DetailsPanelData } from "@/app-shell/details-panel";
import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import { wrapSynopsis } from "@/app-shell/details-view";
import type { ShellPanelLine } from "@/app-shell/types";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const seed = { title: "Frieren", type: "series" as const, year: "2023", score: 8.9 };

describe("DetailsSheet", () => {
  it("shows skeletons before the detail loads", () => {
    const model = buildDetailsSheet({ seed, detail: null, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    expect(frame).toContain("Frieren");
    expect(frame).toContain("★8.9");
    expect(frame).toContain("░");
  });

  it("renders synopsis, facts, links and actions once loaded", () => {
    const detail = {
      id: "1",
      type: "series",
      title: "Frieren",
      synopsis: "An elf mage journeys.",
      genres: ["Adventure"],
      studios: ["Madhouse"],
      episodeCount: 28,
      cast: [{ name: "Atsumi", kind: "voice" }],
      externalLinks: [{ label: "MyAnimeList", url: "https://mal/1" }],
      trailerUrl: "https://yt/abc",
    } as unknown as TitleDetail;
    const model = buildDetailsSheet({ seed, detail, history: null, availability: null });
    const frame = captureFrame(<DetailsSheet model={model} seasonsExpanded={false} width={90} />, {
      columns: 100,
    });
    expect(frame).toContain("An elf mage journeys.");
    expect(frame).toContain("Madhouse");
    expect(frame).toContain("MyAnimeList");
    expect(frame).toContain("trailer");
  });
});

// ---------------------------------------------------------------------------
// DetailsSheetUI — the browse-companion card. Regression coverage for the
// label/value collapse ("WatchlistNot saved") and the body-slice misalignment
// that skipped the first section whenever a synopsis existed.
// ---------------------------------------------------------------------------

const LONG_SYNOPSIS =
  "A compiled smoke fixture movie used to verify the details sheet renders without overlapping rows. " +
  "It has a deliberately long overview so the synopsis wraps across multiple lines inside the bordered card.";

const COMPANION_DATA: DetailsPanelData = {
  primary: {
    title: "Smoke Movie",
    type: "movie",
    year: "2026",
    genres: ["Drama", "Mystery"],
    synopsis: LONG_SYNOPSIS,
  },
  secondary: null,
};

// Body lines exactly as buildDetailsSheetLines emits them: the sheet header
// owns Title/At a glance/synopsis, so `lines` starts at the first section.
const COMPANION_LINES: readonly ShellPanelLine[] = [
  { label: "─── Management", detail: "" },
  { label: "Watchlist", detail: "Not saved · /bookmark to add" },
  { label: "Favourite", detail: "Not favourited · f to add" },
  { label: "─── Details", detail: "" },
  { label: "Type", detail: "Movie" },
  { label: "Year", detail: "2026" },
  { label: "Rating", detail: "8.4 ★" },
];

function renderCompanion(previewWidth: number, columns: number): string {
  return captureFrame(
    <DetailsSheetUI
      data={COMPANION_DATA}
      lines={COMPANION_LINES}
      width={previewWidth}
      scrollIndex={0}
      maxVisibleLines={14}
    />,
    { columns, rows: 40 },
  );
}

describe("DetailsSheetUI companion", () => {
  // Companion widths the shell hands the sheet for these terminal sizes, from
  // browse-shell's previewWidth formula: 80 → medium floor 26, 100 → medium
  // 26 (28% of 92 rounds down), 140 → wide 30% of 132 = 39.
  const cases = [
    { columns: 80, previewWidth: 26 },
    { columns: 100, previewWidth: 26 },
    { columns: 140, previewWidth: 39 },
  ] as const;

  for (const { columns, previewWidth } of cases) {
    it(`keeps label and value separate at terminal width ${columns} (card ${previewWidth})`, () => {
      const frame = renderCompanion(previewWidth, columns);
      const rows = frame.split("\n");

      // The regression: the row budget ignored border + padding, so Yoga
      // shrank the label cell and ate the only separator.
      expect(frame).not.toContain("WatchlistNot");
      expect(frame).not.toContain("FavouriteNot");
      expect(rows.some((row) => /Watchlist {2,}Not saved/.test(row))).toBe(true);
      expect(rows.some((row) => row.includes("─── Management"))).toBe(true);
      expect(rows.some((row) => row.includes("Smoke Movie"))).toBe(true);
    });
  }

  it("clamps itself to the height the layout gives it instead of overlapping rows", () => {
    // The regression: the card rendered its full natural height into a
    // height-bounded flex row; Yoga compressed children to zero height and
    // sibling rows painted over each other. With maxHeight set the card must
    // stay inside its budget and disclose the clip with a scroll affordance.
    const maxHeight = 12;
    const frame = captureFrame(
      <DetailsSheetUI
        data={COMPANION_DATA}
        lines={COMPANION_LINES}
        width={39}
        scrollIndex={0}
        maxVisibleLines={14}
        maxHeight={maxHeight}
      />,
      { columns: 140, rows: 40 },
    );
    const rows = frame.split("\n");
    const top = rows.findIndex((row) => row.includes("┌"));
    const bottom = rows.findIndex((row) => row.includes("└"));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThan(top);
    expect(bottom - top + 1).toBeLessThanOrEqual(maxHeight);
    expect(frame).toContain("▼ scroll");
    expect(frame).not.toContain("WatchlistNot");
    // Favourite is clipped rather than half-painted over the Details header.
    expect(frame).not.toContain("FavouriteNot");
  });

  it("hides the scroll affordance when every body row fits the height budget", () => {
    const frame = captureFrame(
      <DetailsSheetUI
        data={COMPANION_DATA}
        lines={COMPANION_LINES}
        width={39}
        scrollIndex={0}
        maxVisibleLines={14}
        maxHeight={40}
      />,
      { columns: 140, rows: 60 },
    );
    expect(frame).toContain("Rating");
    expect(frame).not.toContain("▼ scroll");
  });

  it("shows a synopsis fallback instead of a blank gap", () => {
    const frame = captureFrame(
      <DetailsSheetUI
        data={{ ...COMPANION_DATA, primary: { ...COMPANION_DATA.primary, synopsis: "" } }}
        lines={COMPANION_LINES}
        width={39}
        scrollIndex={0}
        maxVisibleLines={14}
      />,
      { columns: 140, rows: 40 },
    );
    expect(frame).toContain("No synopsis available");
  });

  it("does not scroll under the last body line", () => {
    const frame = captureFrame(
      <DetailsSheetUI
        data={COMPANION_DATA}
        lines={COMPANION_LINES}
        width={39}
        scrollIndex={99}
        maxVisibleLines={4}
      />,
      { columns: 140, rows: 40 },
    );
    // Clamped to maxScroll, so the tail of the body must stay visible.
    expect(frame).toContain("8.4");
    expect(frame).toContain("Rating");
  });
});

describe("wrapSynopsis", () => {
  it("caps output lines at small widths", () => {
    const lines = wrapSynopsis(LONG_SYNOPSIS, 40, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(42);
    }
  });
});
