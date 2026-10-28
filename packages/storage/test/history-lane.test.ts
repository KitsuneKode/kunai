import { afterEach, expect, test } from "bun:test";

import { historyProviderLane } from "@kunai/core";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

import { HistoryRepository } from "../src";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();
afterEach(() => stores.cleanup());

test("SQL lane projection agrees with replay identity, including legacy and malformed metadata", () => {
  const db = stores.store("history-lane", "data");
  const repo = new HistoryRepository(db);
  const add = (
    id: string,
    kind: MediaKind,
    providerId?: string,
    externalIds?: ProviderExternalIds,
  ) =>
    repo.upsertProgress({
      title: { id, kind, title: id, externalIds },
      providerId,
      positionSeconds: 90,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  add("legacy", "anime");
  add("native", "series", "hianime");
  add("linked", "series", "vidlink", { anilistId: "21" });
  add("video", "video", "youtube");
  add("legacy-video", "series", "vidlink", { youtubeId: "aqz-KE-bpKQ" });
  add("movie", "movie", "vidlink");
  add("malformed", "series", "vidlink");
  db.query(
    "UPDATE history_progress SET external_ids_json = 'invalid' WHERE title = 'malformed'",
  ).run();
  const all = repo.listLatestByTitle();
  for (const lane of ["series", "anime", "youtube"] as const) {
    expect(
      repo
        .listLatestByTitle(500, lane)
        .map((row) => row.titleId)
        .sort(),
    ).toEqual(
      all
        .filter((row) => historyProviderLane(row) === lane)
        .map((row) => row.titleId)
        .sort(),
    );
  }
});

test("lane filtering never resurrects an older episode after the latest row changed lane", () => {
  const db = stores.store("latest-lane", "data");
  const repo = new HistoryRepository(db);
  const title = { id: "changed", kind: "series" as const, title: "Changed" };
  repo.upsertProgress({
    title,
    episode: { season: 1, episode: 1 },
    providerId: "hianime",
    positionSeconds: 90,
    updatedAt: "2026-01-01T00:00:00Z",
  });
  repo.upsertProgress({
    title,
    episode: { season: 1, episode: 2 },
    providerId: "vidlink",
    positionSeconds: 90,
    updatedAt: "2026-01-02T00:00:00Z",
  });
  db.query(
    "UPDATE history_progress SET media_kind = 'series', provider_id = 'vidlink', external_ids_json = NULL WHERE episode = 2",
  ).run();
  expect(repo.listLatestByTitle()).toHaveLength(1);
  expect(repo.listLatestByTitle(500, "anime")).toEqual([]);
  expect(repo.listLatestByTitle(500, "series")[0]?.episode).toBe(2);
});
