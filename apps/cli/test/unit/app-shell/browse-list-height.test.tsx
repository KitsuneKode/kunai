import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getBrowseStackedCompanionRows,
  resolveBrowseStackedListLayout,
} from "@/app-shell/browse-companion-budget";
import { PREVIEW_POSTER_ROWS } from "@/app-shell/browse-shell-view";
import {
  buildDetailsPanelDataFromBrowseOption,
  buildDetailsSheetLines,
} from "@/app-shell/details-panel";
import { BROWSE_LIST_MIN_ROWS } from "@/app-shell/layout-policy";
import { getBrowseChromeRows, getBrowseListMaxVisible } from "@/app-shell/layout-policy";
import {
  estimatePreviewRailRowBudget,
  shouldRenderBrowsePreviewRail,
} from "@/app-shell/primitives/PreviewRail.model";
import type { BrowseShellOption } from "@/app-shell/types";

import { BrowseSearchCapture } from "../../harness/capture-browse-search";
import { captureFrame, stripAnsi } from "../../harness/render-capture";

const CAPTURE_DIR = path.join(import.meta.dir, "../../__captures__");

const RICH_OPTION: BrowseShellOption<string> = {
  value: "demo",
  label: "The Odyssey (2026)",
  previewTitle: "The Odyssey",
  previewMeta: ["Movie", "2026"],
  previewBody: "A retelling of Homer's epic voyage across the ancient Mediterranean.",
  previewFacts: [
    { label: "Watchlist", detail: "Not saved · /bookmark to add", tone: "neutral" },
    { label: "Title aliases", detail: "No alternate title aliases returned", tone: "neutral" },
    {
      label: "Audio and subtitles",
      detail:
        "audio availability unknown until resolve  ·  subtitle availability unknown until resolve",
      tone: "neutral",
    },
  ],
};

const VIEWPORT_CASES = [
  { columns: 100, rows: 30 },
  { columns: 100, rows: 32 },
  { columns: 100, rows: 40 },
  { columns: 110, rows: 40 },
  { columns: 120, rows: 40 },
] as const;

function selectedRowVisible(frame: string, label: string): boolean {
  const lines = frame.split("\n");
  return lines.some((line) => line.includes("▌") && line.includes(label));
}

function listRowCount(frame: string): number {
  return frame.split("\n").filter((line) => /^\s*▌? .+\(\d{4}\)/.test(line)).length;
}

describe("browse list height budget", () => {
  test("only shows the preview rail beside a wide list", () => {
    expect(
      shouldRenderBrowsePreviewRail({
        companionBesideList: false,
        listWidth: 75,
        hasModel: true,
      }),
    ).toBe(false);
    expect(
      shouldRenderBrowsePreviewRail({
        companionBesideList: true,
        listWidth: 75,
        hasModel: true,
      }),
    ).toBe(true);
    expect(
      shouldRenderBrowsePreviewRail({
        companionBesideList: true,
        listWidth: 48,
        hasModel: true,
      }),
    ).toBe(false);
  });

  test("hides the stacked companion before shrinking the list below the floor", () => {
    const chromeRows = getBrowseChromeRows({
      hasResultSubtitle: true,
      hasFilterBar: false,
      hasFilterBadges: false,
      hasCalendarChrome: false,
      hasContextStrip: false,
      hasQueryDirtyHint: false,
      commandMode: false,
    });
    const natural = 12;
    const layout = resolveBrowseStackedListLayout({
      terminalRows: 30,
      chromeRows,
      listItemCount: 4,
      stackedCompanionNaturalRows: natural,
    });
    expect(layout.showStackedCompanion).toBe(false);
    expect(layout.stackedCompanionRows).toBe(0);
    expect(layout.listMaxVisible).toBeGreaterThanOrEqual(Math.min(4, BROWSE_LIST_MIN_ROWS));
  });

  test("reserves stacked companion rows for medium browse terminals", () => {
    const companionView = buildDetailsPanelDataFromBrowseOption(RICH_OPTION);
    const lines = buildDetailsSheetLines(RICH_OPTION, companionView.secondary);
    const stacked = getBrowseStackedCompanionRows({
      showCompanion: true,
      companionBesideList: false,
      showPreviewRail: false,
      previewRailModel: null,
      previewWidth: 92,
      companionView,
      detailsLines: lines,
      detailsMaxVisibleLines: 10,
    });
    const chromeRows = getBrowseChromeRows({
      hasResultSubtitle: true,
      hasFilterBar: false,
      hasFilterBadges: false,
      hasCalendarChrome: false,
      hasContextStrip: false,
      hasQueryDirtyHint: false,
      commandMode: false,
    });
    const visibleAt40 = getBrowseListMaxVisible(40, chromeRows, undefined, undefined, stacked);
    const visibleWithoutStack = getBrowseListMaxVisible(40, chromeRows);
    expect(stacked).toBeGreaterThan(8);
    expect(visibleAt40).toBeLessThan(visibleWithoutStack);
    expect(visibleAt40).toBeGreaterThanOrEqual(1);
  });

  test("does not reserve stacked rows when the rail sits beside the list", () => {
    expect(
      getBrowseStackedCompanionRows({
        showCompanion: true,
        companionBesideList: true,
        showPreviewRail: true,
        previewRailModel: {
          title: "Demo",
          posterState: "none",
          facts: [],
        },
        previewWidth: 36,
        companionView: buildDetailsPanelDataFromBrowseOption(RICH_OPTION),
        detailsLines: [],
        detailsMaxVisibleLines: 14,
      }),
    ).toBe(0);
    expect(
      estimatePreviewRailRowBudget(
        { title: "Demo", posterState: "none", facts: [{ label: "State", value: "ok" }] },
        { reserveRows: PREVIEW_POSTER_ROWS, bodyWidth: 30 },
      ),
    ).toBeGreaterThanOrEqual(PREVIEW_POSTER_ROWS + 2);
  });
});

describe("browse search layout captures", () => {
  for (const size of VIEWPORT_CASES) {
    test(`keeps the selected row visible at ${size.columns}×${size.rows}`, () => {
      const frame = stripAnsi(
        captureFrame(<BrowseSearchCapture />, { columns: size.columns, rows: size.rows }),
      );
      const resultCount = 4;
      const minRows = Math.min(resultCount, BROWSE_LIST_MIN_ROWS);
      expect(selectedRowVisible(frame, "The Odyssey"), frame).toBe(true);
      expect(listRowCount(frame), frame).toBeGreaterThanOrEqual(minRows);
      expect(listRowCount(frame), frame).toBeLessThanOrEqual(8);
    });
  }

  test("shows the beside-list rail at 120×40 when TMUX is not constraining the profile", () => {
    const previous = process.env.TMUX;
    delete process.env.TMUX;
    try {
      const frame = stripAnsi(captureFrame(<BrowseSearchCapture />, { columns: 120, rows: 40 }));
      expect(frame).toContain("The Odyssey");
      expect(frame).toMatch(/Progress|Open|Aliases|At a glance/);
    } finally {
      if (previous === undefined) delete process.env.TMUX;
      else process.env.TMUX = previous;
    }
  });

  test("committed browse-search goldens match live renders", async () => {
    for (const size of VIEWPORT_CASES) {
      const name = `${size.columns}x${size.rows}`;
      const file = path.join(CAPTURE_DIR, `browse-search.${name}.txt`);
      const committed = await readFile(file, "utf8");
      const live = stripAnsi(
        captureFrame(<BrowseSearchCapture />, { columns: size.columns, rows: size.rows }),
      );
      const [, ...body] = committed.split("\n");
      expect(body.join("\n").trimEnd(), `browse-search.${name}.txt is stale`).toBe(live.trimEnd());
    }
  });
});
