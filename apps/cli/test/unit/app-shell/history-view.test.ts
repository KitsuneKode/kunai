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

const viewFor = (
  entry: HistoryProgress,
  tab: "continue" | "completed" | "new-episodes",
  context: Parameters<typeof buildHistoryView>[0]["context"] = {},
) =>
  buildHistoryView({
    entries: [[entry.titleId, entry]],
    tab,
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context,
  });

// Honest model: a finished episode with NO authoritative schedule signal is treated
// as caught-up → Completed. We do NOT fabricate a phantom next episode (the old bug
// that flooded "New episodes" and emptied "Completed").
test("history view marks a finished series with no schedule data as completed, not new", () => {
  const finishedSeries = progress({
    titleId: "tmdb:1",
    season: 2,
    episode: 3,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
  });

  expect(viewFor(finishedSeries, "completed").flatRows.map((r) => r.titleId)).toContain("tmdb:1");
  expect(viewFor(finishedSeries, "new-episodes").state).toBe("empty");
  expect(viewFor(finishedSeries, "continue").state).toBe("empty");
});

// A genuinely freshly-aired episode (released AFTER last watch) lands in New episodes.
test("history view puts a freshly-aired episode in New episodes, not Completed", () => {
  const watched = progress({
    titleId: "tmdb:2",
    season: 1,
    episode: 8,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const fresh = {
    releaseSignals: new Map([
      [
        "tmdb:2",
        {
          status: "new-episodes" as const,
          newEpisodeCount: 1,
          latestKnownReleaseAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    ]),
  };

  expect(viewFor(watched, "new-episodes", fresh).flatRows.map((r) => r.titleId)).toContain(
    "tmdb:2",
  );
  expect(viewFor(watched, "completed", fresh).state).toBe("empty");
});

// A backlog you fell behind on (aired BEFORE you last watched) is Continue, not New.
test("history view puts an aired backlog in Continue, not New", () => {
  const watched = progress({
    titleId: "tmdb:3",
    season: 1,
    episode: 10,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
    updatedAt: "2026-05-20T00:00:00.000Z",
  });
  const backlog = {
    releaseSignals: new Map([
      [
        "tmdb:3",
        {
          status: "new-episodes" as const,
          newEpisodeCount: 14,
          latestKnownReleaseAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    ]),
  };

  expect(viewFor(watched, "continue", backlog).flatRows.map((r) => r.titleId)).toContain("tmdb:3");
  expect(viewFor(watched, "new-episodes", backlog).state).toBe("empty");
});

// A finished movie is genuinely done — it stays out of Continue (Restart lives in Completed).
test("history view keeps a finished movie out of the Continue tab", () => {
  const finishedMovie = progress({
    titleId: "tmdb:movie",
    mediaKind: "movie",
    season: 1,
    episode: 1,
    positionSeconds: 6000,
    durationSeconds: 6000,
    completed: true,
  });
  const continueView = buildHistoryView({
    entries: [["tmdb:movie", finishedMovie]],
    tab: "continue",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
  });
  expect(continueView.state).toBe("empty");

  const completedView = buildHistoryView({
    entries: [["tmdb:movie", finishedMovie]],
    tab: "completed",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
  });
  expect(completedView.flatRows.map((r) => r.titleId)).toContain("tmdb:movie");
});
