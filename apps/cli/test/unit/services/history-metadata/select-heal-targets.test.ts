import { describe, expect, it } from "bun:test";

import { selectHistoryHealTargets } from "@/services/history-metadata/select-heal-targets";
import type { HistoryProgress } from "@kunai/storage";

function entry(over: Partial<HistoryProgress> & { titleId: string }): HistoryProgress {
  return {
    key: `${over.titleId}:${over.episode ?? 1}`,
    titleId: over.titleId,
    mediaKind: over.mediaKind ?? "anime",
    title: over.title ?? over.titleId,
    season: over.season ?? 1,
    episode: over.episode ?? 1,
    positionSeconds: 0,
    completed: over.completed ?? true,
    updatedAt: over.updatedAt ?? "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  } as HistoryProgress;
}

describe("selectHistoryHealTargets", () => {
  it("selects titles missing a poster", () => {
    const targets = selectHistoryHealTargets([entry({ titleId: "a", title: "A" })]);
    expect(targets.map((t) => t.titleId)).toEqual(["a"]);
    expect(targets[0]?.needsPoster).toBe(true);
  });

  it("selects titles missing external ids", () => {
    const targets = selectHistoryHealTargets([
      entry({ titleId: "a", title: "A", posterUrl: "https://img/a.jpg" }),
    ]);
    expect(targets[0]?.needsExternalIds).toBe(true);
  });

  it("skips fully-resolved titles (poster + external ids present)", () => {
    const targets = selectHistoryHealTargets([
      entry({ titleId: "a", posterUrl: "https://img/a.jpg", externalIds: { anilistId: "1" } }),
    ]);
    expect(targets).toHaveLength(0);
  });

  it("collapses a title's many episodes to one target using its latest row", () => {
    const targets = selectHistoryHealTargets([
      entry({ titleId: "a", episode: 1, updatedAt: "2026-06-01T00:00:00.000Z" }),
      entry({ titleId: "a", episode: 2, updatedAt: "2026-06-02T00:00:00.000Z", season: 2 }),
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.anchorSeason).toBe(2); // latest row's season
  });

  it("orders by most-recent watch and caps to the limit", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({
        titleId: `t${i}`,
        updatedAt: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const targets = selectHistoryHealTargets(entries, { limit: 3 });
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.titleId)).toEqual(["t9", "t8", "t7"]);
  });
});
