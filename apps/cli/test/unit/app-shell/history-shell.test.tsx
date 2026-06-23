import { expect, test } from "bun:test";

import { HistoryShell } from "@/app-shell/history-shell";
import type { HistoryView, HistoryViewRow } from "@/app-shell/history-view";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Build the ESC matcher without a literal control char (oxlint no-control-regex).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function row(
  title: string,
  ep: string,
  status: string,
  pct: number | null,
  recency: string,
  badge?: string,
): HistoryViewRow {
  return {
    titleId: title,
    title,
    episodeCode: ep,
    statusLabel: status,
    statusColor: "#d98",
    statusDim: true,
    detail: "",
    recencyLabel: recency,
    badge,
    progress: pct === null ? null : { percentage: pct, completed: false },
    resumeAction: "resume where you left off",
    dualSourceAvailable: false,
  };
}

function renderHistory(
  overrides: Partial<Pick<HistoryView, "rail">> = {},
  layout: {
    readonly columns?: number;
    readonly listWidth?: number;
    readonly rowWidth?: number;
  } = {},
): string {
  const rows: HistoryViewRow[] = [
    row("Teach You a Lesson", "S01E11", "new", 22, "1w ago", "new"),
    row("Pro Bono", "S01E02", "8%", 8, "2w ago"),
    row("The Eminence in Shadow", "S01E07", "39%", 39, "4w ago"),
  ];
  const view: HistoryView = {
    state: "success",
    tab: "all",
    tabLabels: ["Continue", "Completed", "New episodes", "All"],
    tabIndex: 3,
    typeFilter: "all",
    typeFilterLabels: ["All", "Anime", "Series", "Movie", "Tracked"],
    typeFilterIndex: 0,
    flatRows: rows,
    filterQuery: "",
    showScrollUp: false,
    showScrollDown: false,
    rail: null,
    ...overrides,
    items: rows.map((r, i) => ({ kind: "row" as const, row: r, flatIndex: i, selected: i === 2 })),
  };
  const columns = layout.columns ?? 120;
  return captureFrame(
    <HistoryShell
      view={view}
      columns={columns}
      listWidth={layout.listWidth ?? 80}
      rowWidth={layout.rowWidth ?? 76}
    />,
    { columns },
  ).replace(ANSI, "");
}

test("progress renders inline in the row, never on a detached line", () => {
  const lines = renderHistory().split("\n");
  const progressRow = lines.find((l) => l.includes("The Eminence in Shadow"));
  expect(progressRow).toBeDefined();
  // The meter sits on the same line as the title, alongside the percent.
  expect(progressRow).toContain("▰");
  expect(progressRow).toContain("39%");
  // No line may consist solely of bar/track glyphs (the old detached full-width bar).
  const detached = lines.filter((l) => l.trim().length > 0 && /^[▰▱█┈]+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("a badge row keeps its badge as status, even with progress (no meter)", () => {
  // "Teach You a Lesson" has a `new` badge AND progress — the badge must win so the
  // "new episode" signal is never replaced by a progress meter.
  const lines = renderHistory().split("\n");
  const badgeRow = lines.find((l) => l.includes("Teach You a Lesson"));
  expect(badgeRow).toBeDefined();
  expect(badgeRow).toContain("new");
  expect(badgeRow).not.toContain("▰");
});

test("wide history rail clamps list rows inside terminal width", () => {
  const columns = 130;
  const frame = renderHistory(
    {
      rail: {
        title: "The Eminence in Shadow",
        subtitle: "S01E07",
        overview: "A selected history item with a right-hand preview rail.",
        posterState: "none",
        facts: [{ label: "Next", value: "resume where you left off", tone: "success" }],
      },
    },
    { columns, listWidth: 124, rowWidth: 120 },
  );

  const overflowing = frame
    .split("\n")
    .filter((line) => line.trim().length > 0 && line.length > columns);
  expect(overflowing).toHaveLength(0);
});
