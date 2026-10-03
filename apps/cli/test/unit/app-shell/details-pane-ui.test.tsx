import { describe, expect, it } from "bun:test";

import { DetailsSheetUI } from "@/app-shell/details-pane-ui";
import type { DetailsPanelData } from "@/app-shell/details-panel";
import { buildMediaPanel } from "@/app-shell/media-panel-model";
import { MediaPanel } from "@/app-shell/MediaPanel";
import type { ShellPanelLine } from "@/app-shell/types";
import { Box } from "ink";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Regression pin for the fused fact rows seen on the live browse preview:
// "WatchlistNot saved", "Title ali…No alternate title", "episodes367". Yoga
// drops a padded label's trailing space when the row is tight, so the label↔
// value separator has to be a structural columnGap, not a padded column. These
// frames pin real whitespace between every label and value at the widths the
// rails actually render.

const data: DetailsPanelData = {
  primary: { title: "Smoke Movie", type: "movie", year: "2026" },
  secondary: null,
};

// Two leading rows stand in for the title/glance lines the component slices
// off via bodyStart.
const lines: readonly ShellPanelLine[] = [
  { label: "Title", detail: "Smoke Movie" },
  { label: "At a glance", detail: "movie · 2026" },
  { label: "─── Details", detail: "" },
  { label: "Watchlist", detail: "Not saved · /bookmark to add" },
  { label: "Favourite", detail: "Not favourited · f to add" },
  { label: "Title alias", detail: "No alternate title" },
];

describe("DetailsSheetUI fact rows", () => {
  it("keeps whitespace between label and value at preview-rail width", () => {
    const frame = captureFrame(<DetailsSheetUI data={data} lines={lines} width={31} />, {
      columns: 33,
      rows: 30,
    });
    expect(frame).toMatch(/Watchlist\s+Not saved/);
    expect(frame).toMatch(/Favourite\s+Not favourited/);
    expect(frame).toMatch(/Title ali…\s+No alternate/);
  });

  it("still separates when the label fills the whole label column", () => {
    const fullLabel: readonly ShellPanelLine[] = [
      { label: "Title", detail: "Smoke Movie" },
      { label: "At a glance", detail: "movie · 2026" },
      { label: "Watchlists", detail: "saved" },
    ];
    const frame = captureFrame(<DetailsSheetUI data={data} lines={fullLabel} width={31} />, {
      columns: 33,
      rows: 30,
    });
    expect(frame).toMatch(/Watchlists\s+saved/);
  });

  // Regression pin for the live weld: inside a height-squeezed parent, yoga
  // shrinks the sheet's rows to zero height and later rows paint over earlier
  // ones — the real browse frame showed "─── Synopsisot favour…" and
  // "─── DetailsCompiled s…". The sheet root is unshrinkable and the mounting
  // column clips at its bound, so squeeze must clip the tail, never weld rows.
  it("clips the tail instead of welding rows when the parent is height-squeezed", () => {
    const tallLines: readonly ShellPanelLine[] = [
      { label: "Title", detail: "Smoke Movie" },
      { label: "At a glance", detail: "movie · 2026" },
      { label: "─── Management", detail: "" },
      { label: "Watchlist", detail: "Not saved · /bookmark to add" },
      { label: "Favourite", detail: "Not favourited · f to add" },
      { label: "─── Synopsis", detail: "" },
      { label: "Overview", detail: "Compiled smoke movie" },
      { label: "─── Details", detail: "" },
      { label: "Metadata source", detail: "Smoke" },
      { label: "Title aliases", detail: "No alternate title aliases returned" },
      { label: "Provider detail page", detail: "Overview available" },
    ];
    const frame = captureFrame(
      <Box flexDirection="column" height={10} width={32}>
        <Box flexDirection="column" overflow="hidden">
          <DetailsSheetUI
            data={data}
            lines={tallLines}
            width={26}
            scrollIndex={0}
            maxVisibleLines={10}
          />
        </Box>
      </Box>,
      { columns: 34, rows: 14 },
    );
    // No row may contain two contents spliced: a "───" header may only be
    // followed by padding and the box border — never another row's detail.
    for (const line of frame.split("\n")) {
      const headerMatch = line.match(/─── \S+/);
      if (headerMatch) {
        const tail = line.slice(line.indexOf(headerMatch[0]) + headerMatch[0].length);
        expect(tail.replace(/[│\s]/g, "")).toBe("");
      }
    }
    expect(frame).toContain("Watchlist  Not saved");
  });
});

describe("MediaPanel fact rows", () => {
  // Contract pin, not a regression pin: innerWidth's floor of 12 keeps the
  // fact-row budget honest at every real rail width, so pre-fix rows only
  // welded below the floor. This locks the separated contract at the tightest
  // sane rail so a future budget change can't reintroduce the weld silently.
  it("keeps whitespace between a full-width label and its value when tight", () => {
    const model = buildMediaPanel({
      surface: "post-play",
      contentKind: "anime",
      titleType: "series",
      title: "Gintama",
      // SAFETY: partial TitleDetail fixture — the panel only renders the listed fields.
      titleDetail: {
        type: "series",
        year: "2006",
        score: 8.5,
        episodeCount: 367,
        studios: ["Sunrise Animation Studio International"],
      } as never,
      currentSeason: 1,
      currentEpisode: 8,
    });
    const frame = captureFrame(
      <MediaPanel model={model} railWidth={20} placementSlot="postplay-rail" />,
      { columns: 24, rows: 60 },
    );
    // "episodes" is exactly FACT_LABEL_WIDTH — the pad contributes nothing, so
    // only the structural gap keeps it off the value.
    expect(frame).toMatch(/episodes\s+367/);
    expect(frame).toMatch(/score\s+★\s?8\.5/);
  });
});
