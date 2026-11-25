import { expect, test } from "bun:test";

import { initSyncAdapters } from "@/services/sync/init-sync-adapters";
import type { TrackerId } from "@/services/sync/types";

function adapter(id: TrackerId, init: () => Promise<void>) {
  return { id, init };
}

test("one tracker's unreadable credentials do not stop startup or the other tracker", async () => {
  const initialized: TrackerId[] = [];
  const unavailable: TrackerId[] = [];

  await initSyncAdapters(
    [
      adapter("anilist", async () => {
        throw new Error("EACCES: permission denied, open 'sync-tokens.json'");
      }),
      adapter("tmdb", async () => {
        initialized.push("tmdb");
      }),
    ],
    (id) => unavailable.push(id),
  );

  expect(initialized).toEqual(["tmdb"]);
  expect(unavailable).toEqual(["anilist"]);
});

test("the report names the tracker only, never the underlying error", async () => {
  const reports: unknown[][] = [];
  await initSyncAdapters(
    [
      adapter("tmdb", async () => {
        throw new Error("secret-bytes-must-not-leak");
      }),
    ],
    (...args) => reports.push(args),
  );

  expect(reports).toEqual([["tmdb"]]);
});
