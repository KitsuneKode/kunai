import { describe, expect, test } from "bun:test";

import {
  planReleaseReconciliationCandidates,
  RECONCILIATION_TRIGGER_BUDGETS,
} from "@/services/release-reconciliation/ReleaseReconciliationPlanner";
import type { ReleaseReconciliationHistoryRow } from "@/services/release-reconciliation/types";

function row(
  patch: Partial<ReleaseReconciliationHistoryRow> = {},
): ReleaseReconciliationHistoryRow {
  return {
    titleId: "anilist:1",
    mediaKind: "series",
    title: "Demo",
    season: 1,
    episode: 6,
    absoluteEpisode: undefined,
    completed: true,
    externalIds: { anilistId: "1" },
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...patch,
  };
}

describe("ReleaseReconciliationPlanner", () => {
  test("dedupes rows by catalog id and anchors on highest watched episode", () => {
    const plan = planReleaseReconciliationCandidates({
      trigger: "history",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [
        row({ episode: 6, updatedAt: "2026-05-20T00:00:00.000Z" }),
        row({ episode: 2, updatedAt: "2026-05-23T00:00:00.000Z" }),
      ],
      existingProjections: new Map(),
    });

    expect(plan.candidates).toEqual([
      expect.objectContaining({
        titleId: "anilist:1",
        source: "anilist",
        anchorEpisode: 6,
      }),
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("treats anime rows as episodic series candidates", () => {
    const plan = planReleaseReconciliationCandidates({
      trigger: "history",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [
        row({ mediaKind: "anime", titleId: "anilist:42", externalIds: { anilistId: "42" } }),
      ],
      existingProjections: new Map(),
    });

    expect(plan.candidates[0]).toMatchObject({
      titleId: "anilist:42",
      mediaKind: "anime",
      source: "anilist",
      catalogId: "42",
    });
  });

  test("skips movies, missing catalog identity, stale-disabled rows, and not-due projections", () => {
    const plan = planReleaseReconciliationCandidates({
      trigger: "browse-idle",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [
        row({ titleId: "movie:1", mediaKind: "movie", externalIds: { anilistId: "9" } }),
        row({ titleId: "unknown", externalIds: undefined }),
        row({ titleId: "muted", externalIds: { anilistId: "2" } }),
        row({ titleId: "anilist:3", externalIds: { anilistId: "3" } }),
      ],
      mutedTitleIds: new Set(["muted"]),
      existingProjections: new Map([
        [
          "anilist:3",
          {
            titleId: "anilist:3",
            nextCheckAt: "2026-05-23T13:00:00.000Z",
          },
        ],
      ]),
    });

    expect(plan.candidates).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual([
      "movie",
      "missing-catalog-id",
      "muted",
      "not-due",
    ]);
  });

  test("applies trigger budgets before catalog work", () => {
    const rows = Array.from(
      { length: RECONCILIATION_TRIGGER_BUDGETS["browse-idle"] + 5 },
      (_, index) =>
        row({
          titleId: `anilist:${index + 1}`,
          title: `Demo ${index + 1}`,
          externalIds: { anilistId: String(index + 1) },
        }),
    );

    const plan = planReleaseReconciliationCandidates({
      trigger: "browse-idle",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: rows,
      existingProjections: new Map(),
    });

    expect(plan.candidates).toHaveLength(RECONCILIATION_TRIGGER_BUDGETS["browse-idle"]);
    expect(plan.skipped.filter((skip) => skip.reason === "budget-exhausted")).toHaveLength(5);
  });

  test("prioritizes selected and enrolled titles before dormant history within a budget", () => {
    const plan = planReleaseReconciliationCandidates({
      trigger: "post-playback",
      now: "2026-05-23T12:00:00.000Z",
      historyRows: [
        row({ titleId: "anilist:1", externalIds: { anilistId: "1" } }),
        row({ titleId: "anilist:2", externalIds: { anilistId: "2" } }),
        row({ titleId: "anilist:3", externalIds: { anilistId: "3" } }),
      ],
      attentionByTitleId: new Map([
        ["anilist:1", "dormant-history"],
        ["anilist:2", "offline-enrolled"],
        ["anilist:3", "selected-title"],
      ]),
      existingProjections: new Map(),
    });

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      titleId: "anilist:3",
      attention: "selected-title",
    });
  });
});
