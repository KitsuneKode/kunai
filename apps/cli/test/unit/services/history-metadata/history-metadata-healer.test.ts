import { describe, expect, it } from "bun:test";

import { HistoryMetadataHealer } from "@/services/history-metadata/HistoryMetadataHealer";
import type { ResolvedHistoryMetadata } from "@/services/history-metadata/HistoryMetadataHealer";
import type { HistoryProgress } from "@kunai/storage";

function entry(over: Partial<HistoryProgress> & { titleId: string }): HistoryProgress {
  return {
    key: `${over.titleId}:1`,
    mediaKind: over.mediaKind ?? "anime",
    title: over.title ?? over.titleId,
    season: 1,
    episode: 1,
    positionSeconds: 0,
    completed: true,
    updatedAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  } as HistoryProgress;
}

type Backfill = { titleId: string; posterUrl?: string; externalIds?: unknown };

function harness(resolved: Record<string, ResolvedHistoryMetadata | null>) {
  const backfills: Backfill[] = [];
  const healer = new HistoryMetadataHealer({
    resolver: {
      resolve: async (target) => resolved[target.titleId] ?? null,
    },
    repo: {
      backfillTitleMetadata: (titleId, metadata) =>
        backfills.push({
          titleId,
          posterUrl: metadata.posterUrl,
          externalIds: metadata.externalIds,
        }),
    },
  });
  return { healer, backfills };
}

describe("HistoryMetadataHealer", () => {
  it("backfills resolved poster + external ids for titles that need it", async () => {
    const { healer, backfills } = harness({
      a: { posterUrl: "https://img/a.jpg", externalIds: { anilistId: "103223" } },
    });

    const healed = await healer.heal([entry({ titleId: "a", title: "Barakamon" })]);

    expect(backfills).toEqual([
      { titleId: "a", posterUrl: "https://img/a.jpg", externalIds: { anilistId: "103223" } },
    ]);
    expect(healed).toEqual(["a"]);
  });

  it("skips titles the resolver cannot match (no backfill, not reported healed)", async () => {
    const { healer, backfills } = harness({ a: null });
    const healed = await healer.heal([entry({ titleId: "a" })]);
    expect(backfills).toHaveLength(0);
    expect(healed).toEqual([]);
  });

  it("does not touch already-resolved titles", async () => {
    const { healer, backfills } = harness({});
    await healer.heal([
      entry({ titleId: "a", posterUrl: "https://img/a.jpg", externalIds: { anilistId: "1" } }),
    ]);
    expect(backfills).toHaveLength(0);
  });
});
