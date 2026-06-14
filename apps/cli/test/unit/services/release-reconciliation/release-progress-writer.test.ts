import { describe, expect, it } from "bun:test";

import { ReleaseProgressWriter } from "@/services/release-reconciliation/ReleaseProgressWriter";
import type { ReleaseProgressProjection } from "@kunai/storage";

function projection(over: Partial<ReleaseProgressProjection> = {}): ReleaseProgressProjection {
  return {
    titleId: "t1",
    mediaKind: "series",
    source: "tmdb",
    title: "Show",
    anchorEpisode: 1,
    newEpisodeCount: 0,
    status: "up-to-date",
    checkedAt: "2026-06-14T00:00:00.000Z",
    nextCheckAt: "2026-06-14T02:00:00.000Z",
    staleAfterAt: "2026-06-15T00:00:00.000Z",
    sourceFingerprint: "fp",
    errorCount: 0,
    ...over,
  };
}

function fakeRepo() {
  const rows = new Map<string, ReleaseProgressProjection>();
  return {
    upsert: (p: ReleaseProgressProjection) => rows.set(p.titleId, p),
    getByTitleIds: (ids: readonly string[]) => {
      const m = new Map<string, ReleaseProgressProjection>();
      for (const id of ids) {
        const r = rows.get(id);
        if (r) m.set(id, r);
      }
      return m;
    },
    _rows: rows,
  };
}

describe("ReleaseProgressWriter", () => {
  it("authoritative always writes", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertAuthoritative(projection({ newEpisodeCount: 3 }));
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(3);
  });

  it("optimistic writes when no existing row", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertOptimistic(projection({ newEpisodeCount: 2 }), "2026-06-14T01:00:00.000Z");
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(2);
  });

  it("optimistic skips when a fresh row already exists", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertAuthoritative(
      projection({ newEpisodeCount: 0, staleAfterAt: "2026-06-15T00:00:00.000Z" }),
    );
    writer.upsertOptimistic(projection({ newEpisodeCount: 5 }), "2026-06-14T01:00:00.000Z");
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(0); // authoritative preserved
  });

  it("optimistic writes when the existing row is stale", () => {
    const repo = fakeRepo();
    const writer = new ReleaseProgressWriter(repo);
    writer.upsertAuthoritative(
      projection({ newEpisodeCount: 0, staleAfterAt: "2026-06-14T00:30:00.000Z" }),
    );
    writer.upsertOptimistic(projection({ newEpisodeCount: 5 }), "2026-06-14T01:00:00.000Z");
    expect(repo._rows.get("t1")?.newEpisodeCount).toBe(5);
  });
});
