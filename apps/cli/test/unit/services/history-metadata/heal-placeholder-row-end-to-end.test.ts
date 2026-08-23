// End-to-end over a real database: the exact row `kunai -i 438631 -t movie`
// used to leave behind, healed by the real repository, selector, resolver, and
// healer. Only the catalog fetch is stubbed.

import { afterEach, expect, test } from "bun:test";

import type { TitleDetail } from "@/domain/catalog/title-detail";
import { createHistoryMetadataResolver } from "@/services/history-metadata/create-history-metadata-resolver";
import { HistoryMetadataHealer } from "@/services/history-metadata/HistoryMetadataHealer";
import { resolveTmdbIdentity } from "@/services/sync/sync-identity";
import { HistoryRepository } from "@kunai/storage";
import { createTempStoreRegistry } from "@kunai/storage/testing";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

const duneDetail: TitleDetail = {
  id: "438631",
  type: "movie",
  title: "Dune",
  year: "2021",
  artwork: { poster: "/dune.jpg" },
  externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
};

test("a corrupted `-i` row is repaired end to end, and syncs again", async () => {
  const repo = new HistoryRepository(stores.store("heal-e2e", "data"));

  // Exactly what the bug wrote: placeholder title, no poster, no external ids.
  repo.upsertProgress({
    title: { id: "438631", kind: "movie", title: "TMDB 438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
    providerId: "videasy",
  });

  const before = repo.getLatestForTitle("438631");
  expect(before?.title).toBe("TMDB 438631");
  expect(before?.externalIds).toBeUndefined();
  // The consequence that made this more than cosmetic: with no external ids and
  // a bare title id, the row addresses no tracker entry, so it never mirrors.
  expect(
    resolveTmdbIdentity({
      titleId: "438631",
      mediaKind: "movie",
      externalIds: before?.externalIds,
    }),
  ).toBeNull();

  const healer = new HistoryMetadataHealer({
    repo,
    resolver: createHistoryMetadataResolver({
      search: async () => {
        throw new Error("must not text-search a placeholder title");
      },
      fetchDetail: async (titleId) => (titleId === "438631" ? duneDetail : null),
    }),
  });

  await healer.heal(repo.listRecent(100));

  const after = repo.getLatestForTitle("438631");
  expect(after?.title).toBe("Dune");
  expect(after?.posterUrl).toBe("https://image.tmdb.org/t/p/w500/dune.jpg");
  expect(after?.externalIds).toEqual({ tmdbId: "438631", imdbId: "tt1160419" });
  // The progress the user actually watched survives the repair.
  expect(after?.positionSeconds).toBe(15);
  // And the row addresses a tracker entry again.
  expect(
    resolveTmdbIdentity({ titleId: "438631", mediaKind: "movie", externalIds: after?.externalIds }),
  ).toEqual({ tracker: "tmdb", tmdbId: 438631, mediaKind: "movie" });
});

test("a second heal pass is a no-op once the row is healthy", async () => {
  const repo = new HistoryRepository(stores.store("heal-e2e-idempotent", "data"));
  repo.upsertProgress({
    title: { id: "438631", kind: "movie", title: "TMDB 438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
  });

  let fetches = 0;
  const healer = new HistoryMetadataHealer({
    repo,
    resolver: createHistoryMetadataResolver({
      search: async () => [],
      fetchDetail: async () => {
        fetches += 1;
        return duneDetail;
      },
    }),
  });

  await healer.heal(repo.listRecent(100));
  await healer.heal(repo.listRecent(100));

  expect(fetches).toBe(1);
  expect(repo.getLatestForTitle("438631")?.title).toBe("Dune");
});
