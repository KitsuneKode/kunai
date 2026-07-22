import { expect, test } from "bun:test";

import {
  buildHistoryView,
  cycleHistoryTypeFilter,
  historyTypeFilterLabels,
  type HistoryTypeFilter,
} from "@/app-shell/history-view";
import { historyBucketFor } from "@/app-shell/panel-data";
import { buildRootHistorySelection } from "@/app-shell/root-history-bridge";
import { projectContinuationState } from "@/services/continuation/continuation-policy";
import {
  resolveContinueSourceAction,
  resumeLabelForProjection,
} from "@/services/continuation/continuation-source";
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

test("history view surfaces an error state with the failure detail", () => {
  const view = buildHistoryView({
    entries: [],
    tab: "all",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
    error: "database is locked",
  });

  expect(view.state).toBe("error");
  expect(view.errorMessage).toBe("database is locked");
  expect(view.flatRows).toHaveLength(0);
});

test("history view prefers loading over a stale error while reloading", () => {
  const view = buildHistoryView({
    entries: [],
    tab: "all",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {},
    error: "transient blip",
    loading: true,
  });

  expect(view.state).toBe("loading");
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

// Honest model: a finished episode with NO authoritative schedule signal is
// up to date → Completed. We do NOT fabricate a phantom next episode.
test("finished series EPISODE with no schedule data → completed, never fabricated next", () => {
  const finishedSeries = progress({
    titleId: "tmdb:1",
    season: 2,
    episode: 3,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
  });

  expect(viewFor(finishedSeries, "completed").flatRows.map((r) => r.titleId)).toContain("tmdb:1");
  expect(viewFor(finishedSeries, "continue").state).toBe("empty");
  expect(viewFor(finishedSeries, "new-episodes").state).toBe("empty");
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

test("history view keeps finished series with known catalog end out of Continue", () => {
  const watched = progress({
    titleId: "barakamon",
    title: "Barakamon",
    mediaKind: "anime",
    providerId: "allanime",
    season: 1,
    episode: 12,
    positionSeconds: 1371,
    durationSeconds: 1371,
    completed: true,
    updatedAt: "2026-05-04T00:00:00.000Z",
  });
  const bounds = new Map([["barakamon", { season: 1, latestEpisode: 12 }]]);
  const continueView = buildHistoryView({
    entries: [["barakamon", watched]],
    tab: "continue",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: { catalogBounds: bounds },
  });
  expect(continueView.state).toBe("empty");

  const completedView = buildHistoryView({
    entries: [["barakamon", watched]],
    tab: "completed",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {
      catalogBounds: bounds,
      releaseSignals: new Map([
        ["barakamon", { status: "caught-up", newEpisodeCount: 0, latestAiredEpisode: 12 }],
      ]),
    },
  });
  expect(completedView.flatRows.map((row) => row.titleId)).toContain("barakamon");
});

test("history view labels finished anchor with next episode as next instead of done", () => {
  const watched = progress({
    titleId: "native-rampart",
    title: "The Ramparts of Ice",
    mediaKind: "anime",
    providerId: "allanime",
    season: 1,
    episode: 8,
    positionSeconds: 1500,
    durationSeconds: 1500,
    completed: true,
    updatedAt: "2026-05-22T00:00:00.000Z",
  });
  const view = buildHistoryView({
    entries: [["native-rampart", watched]],
    tab: "continue",
    filterQuery: "",
    selectedIndex: 0,
    maxVisible: 50,
    narrow: true,
    context: {
      projections: new Map([
        [
          "native-rampart",
          {
            kind: "new-episodes",
            titleId: "native-rampart",
            title: "The Ramparts of Ice",
            sourceEntry: watched,
            primaryAction: { kind: "select-online", season: 1, episode: 9 },
          },
        ],
      ]),
    },
  });

  expect(view.state).toBe("success");
  const row = view.flatRows[0];
  expect(row?.statusLabel).toBe("next");
  expect(row?.episodeCode).toContain("E09");
  expect(row?.resumeAction).toBe("Play next");
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

test("history bucket placement agrees with projection-derived resume action", () => {
  const unfinished = progress({
    titleId: "resume",
    positionSeconds: 420,
    completed: false,
  });
  const fresh = progress({
    titleId: "fresh",
    season: 1,
    episode: 8,
    positionSeconds: 1200,
    durationSeconds: 1200,
    completed: true,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const context = {
    releaseSignals: new Map([
      [
        "fresh",
        {
          status: "new-episodes" as const,
          newEpisodeCount: 1,
          latestKnownReleaseAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    ]),
  };

  for (const [titleId, entry] of [
    ["resume", unfinished],
    ["fresh", fresh],
  ] as const) {
    const projection = projectContinuationState({
      titleId,
      entries: [[titleId, entry]],
      releaseProgress: titleId === "fresh" ? { newEpisodeCount: 1 } : null,
      nextRelease: titleId === "fresh" ? { season: 1, episode: 9, released: true } : null,
    });
    const bucket = historyBucketFor(titleId, entry, {
      ...context,
      projections: new Map([[titleId, projection]]),
    });
    const tab =
      bucket === "continue" ? "continue" : bucket === "new-episodes" ? "new-episodes" : "completed";
    const view = buildHistoryView({
      entries: [[titleId, entry]],
      tab,
      filterQuery: "",
      selectedIndex: 0,
      maxVisible: 50,
      narrow: true,
      context: {
        ...context,
        projections: new Map([[titleId, projection]]),
      },
    });
    const row = view.flatRows[0];
    expect(row?.resumeAction).toBe(resumeLabelForProjection(projection, bucket));
    const selection = buildRootHistorySelection(
      { titleId, entry },
      titleId === "fresh"
        ? new Map([
            [
              titleId,
              {
                status: "released" as const,
                season: 1,
                episode: 9,
                releaseAt: null,
              },
            ],
          ])
        : undefined,
      new Map([[titleId, projection]]),
      { sourcePreference: "auto" },
    );
    const action = resolveContinueSourceAction(projection, "auto");
    if (action) {
      expect(action.kind).toBeTruthy();
    }
    if (bucket === "continue") {
      expect(selection.targetEpisode?.reason).toMatch(/resume|offline-ready/);
    }
    if (bucket === "new-episodes") {
      expect(selection.targetEpisode?.reason).toBe("new-episode");
    }
  }
});

test("YouTube history is its own facet, not filed under Movies", () => {
  const now = Date.now();
  const ytVideo = progress({
    titleId: "yt-clip",
    title: "AMD Ultimate Tech Upgrade",
    // YouTube rows arrive stored as a movie; the provider is what identifies them.
    mediaKind: "movie",
    providerId: "youtube",
    updatedAt: new Date(now - DAY_MS).toISOString(),
  });
  const realMovie = progress({
    titleId: "film",
    title: "Enemy",
    mediaKind: "movie",
    providerId: "videasy",
    updatedAt: new Date(now - DAY_MS * 2).toISOString(),
  });

  const titlesFor = (typeFilter: HistoryTypeFilter): string[] =>
    buildHistoryView({
      entries: [
        ["yt-clip", ytVideo],
        ["film", realMovie],
      ],
      tab: "all",
      typeFilter,
      filterQuery: "",
      selectedIndex: 0,
      maxVisible: 50,
      narrow: true,
      context: {},
    }).flatRows.map((row) => row.title);

  expect(titlesFor("youtube")).toEqual(["AMD Ultimate Tech Upgrade"]);
  // The point of the facet: a watched video must not sit next to actual films.
  expect(titlesFor("movie")).toEqual(["Enemy"]);
  expect(titlesFor("all").sort()).toEqual(["AMD Ultimate Tech Upgrade", "Enemy"]);
});

test("history type filter cycles through the YouTube facet", () => {
  expect(historyTypeFilterLabels()).toEqual(["All", "Anime", "Series", "Movies", "YouTube"]);
  expect(cycleHistoryTypeFilter("movie")).toBe("youtube");
  expect(cycleHistoryTypeFilter("youtube")).toBe("all");
  expect(cycleHistoryTypeFilter("all", -1)).toBe("youtube");
});
