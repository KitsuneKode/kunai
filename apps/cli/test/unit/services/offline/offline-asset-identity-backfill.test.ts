import { describe, expect, test } from "bun:test";

import { runOfflineAssetIdentityBackfill } from "@/services/offline/offline-asset-identity-backfill";

function assetsStub(titleIds: readonly string[]) {
  const moves: Array<{ from: string; to: string }> = [];
  return {
    moves,
    repo: {
      listDistinctTitleIds: () => titleIds,
      relocateTitleId: (from: string, to: string) => {
        moves.push({ from, to });
        return 1;
      },
    },
  };
}

describe("runOfflineAssetIdentityBackfill", () => {
  test("moves an asset filed under a raw id onto the canonical id history knows", () => {
    const { repo, moves } = assetsStub(["1339713"]);

    const stats = runOfflineAssetIdentityBackfill(repo, {
      lookupTitleIdByAliasId: (id) => (id === "1339713" ? "tmdb:1339713" : undefined),
    });

    expect(moves).toEqual([{ from: "1339713", to: "tmdb:1339713" }]);
    expect(stats).toEqual({ titlesScanned: 1, titlesRelocated: 1, assetsRelocated: 1 });
  });

  test("leaves a title alone when the alias index knows nothing better", () => {
    const { repo, moves } = assetsStub(["1339713"]);

    const stats = runOfflineAssetIdentityBackfill(repo, {
      lookupTitleIdByAliasId: () => undefined,
    });

    expect(moves).toEqual([]);
    expect(stats.titlesRelocated).toBe(0);
  });

  test("is idempotent: a second pass over already-canonical rows moves nothing", () => {
    // It runs on every bootstrap by design — an asset written before history
    // learned the title's ids would be stranded forever by a one-shot marker.
    const { repo, moves } = assetsStub(["tmdb:1339713"]);

    runOfflineAssetIdentityBackfill(repo, {
      lookupTitleIdByAliasId: (id) => (id === "1339713" ? "tmdb:1339713" : undefined),
    });

    expect(moves).toEqual([]);
  });
});
