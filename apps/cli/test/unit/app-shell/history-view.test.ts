import { expect, test } from "bun:test";

import { buildHistoryView } from "@/app-shell/history-view";
import type { HistoryProgress } from "@kunai/storage";

const DAY_MS = 86_400_000;

function progress(over: Partial<HistoryProgress> & { titleId: string }): HistoryProgress {
  const updatedAt = over.updatedAt ?? new Date().toISOString();
  return {
    key: "k",
    title: over.titleId,
    mediaKind: "series",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    createdAt: updatedAt,
    ...over,
    updatedAt,
  };
}

// Regression guard for the "selection juggles across" bug: arrow keys move
// selectedIndex through `flatRows`, while the highlight + layout render `items`.
// If the two orderings disagree, pressing up/down jumps the highlight around.
// The invariant: the displayed row order MUST equal flatRows order.
test("history view keeps flatRows order identical to the displayed item order", () => {
  const now = Date.now();
  // A continue-watching (unfinished) item that is OLDEST — buildHistoryPickerOptions
  // hoists it to the top, while a pure recency layout would bury it under newer rows.
  const inProgressOld = progress({
    titleId: "alpha",
    positionSeconds: 120,
    completed: false,
    updatedAt: new Date(now - DAY_MS * 30).toISOString(),
  });
  const doneToday = progress({
    titleId: "gamma",
    positionSeconds: 1200,
    completed: true,
    updatedAt: new Date(now - 3_600_000).toISOString(),
  });
  const doneThisWeek = progress({
    titleId: "beta",
    positionSeconds: 1200,
    completed: true,
    updatedAt: new Date(now - DAY_MS * 3).toISOString(),
  });

  const view = buildHistoryView({
    entries: [
      ["alpha", inProgressOld],
      ["gamma", doneToday],
      ["beta", doneThisWeek],
    ],
    tab: "all",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
  });

  const rowItems = view.items.filter(
    (item): item is Extract<(typeof view.items)[number], { kind: "row" }> => item.kind === "row",
  );

  // Every displayed row's flatIndex must point back at that same row.
  for (const item of rowItems) {
    expect(view.flatRows[item.flatIndex]?.titleId).toBe(item.row.titleId);
  }

  // The displayed flatIndex sequence must be 0,1,2,… — i.e. display order == nav order.
  expect(rowItems.map((item) => item.flatIndex)).toEqual([...rowItems.keys()]);
  expect(view.flatRows.map((row) => row.titleId)).toEqual(rowItems.map((item) => item.row.titleId));
});

// A finished episode of an ongoing series (no schedule data) should keep offering the
// next episode and NOT be presented as a completed series.
test("history view offers the next episode for a finished series instead of marking it complete", () => {
  const finishedSeries = progress({
    titleId: "tmdb:1",
    season: 2,
    episode: 3,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
  });

  const completedView = buildHistoryView({
    entries: [["tmdb:1", finishedSeries]],
    tab: "completed",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
  });
  // Not in the Completed tab — it has a next episode to watch.
  expect(completedView.state).toBe("empty");

  const allView = buildHistoryView({
    entries: [["tmdb:1", finishedSeries]],
    tab: "all",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
  });
  const row = allView.flatRows[0];
  expect(row?.resumeAction).toBe("Play next");
  expect(row?.episodeCode).toContain("S02E04");
});
