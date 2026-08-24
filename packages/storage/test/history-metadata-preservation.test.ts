// A history write carries whatever metadata the launching lane happened to have.
// A lane with less than the stored row must never subtract from it: `-i 438631
// -t movie` knows only an id, and before this it overwrote a searched row's real
// title with "TMDB 438631" and erased its external ids — which silently took the
// title out of tracker sync, since sync resolves its target from those ids.

import { afterEach, expect, test } from "bun:test";

import { HistoryRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function repo(): HistoryRepository {
  const db = stores.store("history-metadata-preservation", "data");
  return new HistoryRepository(db);
}

/** What a search-lane launch of Dune stores: real name, poster, catalog ids. */
function seedSearchedMovie(r: HistoryRepository): void {
  r.upsertProgress({
    title: {
      id: "438631",
      kind: "movie",
      title: "Dune",
      externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
    },
    positionSeconds: 600,
    durationSeconds: 9325,
    posterUrl: "https://image.tmdb.org/t/p/w342/dune.jpg",
  });
}

test("a placeholder title never overwrites the stored real title", () => {
  const r = repo();
  seedSearchedMovie(r);

  r.upsertProgress({
    title: { id: "438631", kind: "movie", title: "TMDB 438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
  });

  expect(r.getLatestForTitle("438631")?.title).toBe("Dune");
});

test("a title named after its own id never overwrites the stored real title", () => {
  const r = repo();
  r.upsertProgress({
    title: { id: "tmdb:438631", kind: "movie", title: "Dune" },
    positionSeconds: 600,
    durationSeconds: 9325,
  });

  r.upsertProgress({
    title: { id: "tmdb:438631", kind: "movie", title: "tmdb:438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
  });

  expect(r.getLatestForTitle("tmdb:438631")?.title).toBe("Dune");
});

test("a real title still replaces a stored placeholder — heal forward", () => {
  const r = repo();
  r.upsertProgress({
    title: { id: "438631", kind: "movie", title: "TMDB 438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
  });

  r.upsertProgress({
    title: { id: "438631", kind: "movie", title: "Dune" },
    positionSeconds: 600,
    durationSeconds: 9325,
  });

  expect(r.getLatestForTitle("438631")?.title).toBe("Dune");
});

test("an ordinary title change still applies — this is not a freeze", () => {
  const r = repo();
  seedSearchedMovie(r);

  r.upsertProgress({
    title: { id: "438631", kind: "movie", title: "Dune: Part One" },
    positionSeconds: 700,
    durationSeconds: 9325,
  });

  expect(r.getLatestForTitle("438631")?.title).toBe("Dune: Part One");
});

test("a write with no external ids never erases the stored ones", () => {
  const r = repo();
  seedSearchedMovie(r);

  r.upsertProgress({
    title: { id: "438631", kind: "movie", title: "TMDB 438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
  });

  expect(r.getLatestForTitle("438631")?.externalIds).toEqual({
    tmdbId: "438631",
    imdbId: "tt1160419",
  });
});

test("a write with new external ids merges them in, stored ids winning", () => {
  const r = repo();
  seedSearchedMovie(r);

  r.upsertProgress({
    title: {
      id: "438631",
      kind: "movie",
      title: "Dune",
      externalIds: { tmdbId: "999999", malId: "12345" },
    },
    positionSeconds: 700,
    durationSeconds: 9325,
  });

  expect(r.getLatestForTitle("438631")?.externalIds).toEqual({
    tmdbId: "438631",
    imdbId: "tt1160419",
    malId: "12345",
  });
});

test("backfillTitleMetadata repairs a placeholder title across every row", () => {
  const r = repo();
  for (const episode of [1, 2]) {
    r.upsertProgress({
      title: { id: "1396", kind: "series", title: "TMDB 1396" },
      episode: { season: 1, episode },
      positionSeconds: 60,
    });
  }

  r.backfillTitleMetadata("1396", { title: "Breaking Bad" });

  for (const row of r.listByTitle("1396")) {
    expect(row.title).toBe("Breaking Bad");
  }
});

test("backfillTitleMetadata never overwrites a real stored title", () => {
  const r = repo();
  seedSearchedMovie(r);

  r.backfillTitleMetadata("438631", { title: "Something Else" });

  expect(r.getLatestForTitle("438631")?.title).toBe("Dune");
});

test("position, duration, and provider still come from the newest write", () => {
  const r = repo();
  seedSearchedMovie(r);

  r.upsertProgress({
    title: { id: "438631", kind: "movie", title: "TMDB 438631" },
    positionSeconds: 15,
    durationSeconds: 9325,
    providerId: "videasy",
  });

  const row = r.getLatestForTitle("438631");
  expect(row?.positionSeconds).toBe(15);
  expect(row?.providerId).toBe("videasy");
});
