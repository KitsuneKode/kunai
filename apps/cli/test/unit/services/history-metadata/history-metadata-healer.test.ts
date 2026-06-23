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

  it("persists provider-native mapping after external ids are resolved", async () => {
    const { healer, backfills } = harness({
      Frp8xJDSeLh6wEHNk: { posterUrl: "https://img/a.jpg", externalIds: { anilistId: "186497" } },
    });

    const healed = await healer.heal([
      entry({
        titleId: "Frp8xJDSeLh6wEHNk",
        title: "The Ramparts of Ice",
        providerId: "allanime",
      }),
    ]);

    expect(healed).toEqual(["Frp8xJDSeLh6wEHNk"]);
    expect(backfills[0]?.externalIds).toMatchObject({
      anilistId: "186497",
      providerNativeIds: { allanime: "Frp8xJDSeLh6wEHNk" },
    });
  });
});
