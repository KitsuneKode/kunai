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
    progress: pct === null ? null : { percentage: pct, completed: false },
    resumeAction: "resume where you left off",
  };
}

function renderHistory(): string {
  const rows: HistoryViewRow[] = [
    row("Teach You a Lesson", "S01E11", "new", null, "1w ago"),
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
    items: rows.map((r, i) => ({ kind: "row" as const, row: r, flatIndex: i, selected: i === 2 })),
  };
  return captureFrame(<HistoryShell view={view} columns={120} listWidth={80} rowWidth={76} />, {
    columns: 120,
  }).replace(ANSI, "");
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

test("rows without progress keep their plain status label", () => {
  const lines = renderHistory().split("\n");
  const plainRow = lines.find((l) => l.includes("Teach You a Lesson"));
  expect(plainRow).toBeDefined();
  expect(plainRow).toContain("new");
  expect(plainRow).not.toContain("▰");
});
