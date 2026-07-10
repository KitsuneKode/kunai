import { expect, test } from "bun:test";

import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import { SyncService } from "@/services/sync/SyncService";

const entry = { titleId: "tmdb:1", mediaKind: "movie" } as never;

function adapter(input: Partial<SyncAdapter>): SyncAdapter {
  return {
    id: input.id ?? "adapter",
    displayName: input.displayName ?? "Adapter",
    isConnected: input.isConnected ?? (() => true),
    getConnectedUsername: () => undefined,
    connect: async () => ({ ok: true }),
    disconnect: async () => {},
    pushWatched: async () => ({ ok: true }),
    ...input,
  };
}

test("pushWatched aggregates rejected adapter results", async () => {
  const service = new SyncService(
    adapter({ id: "anilist", displayName: "AniList" }),
    adapter({
      id: "tmdb",
      displayName: "TMDB",
      pushWatched: async () => ({ ok: false, error: "request failed" }),
    }),
  );

  expect(await service.pushWatched(entry)).toEqual({
    connected: 2,
    succeeded: 1,
    failed: 1,
    failures: ["TMDB: request failed"],
  });
});

test("pushWatched converts adapter throws into failed attempts", async () => {
  const service = new SyncService(
    adapter({
      displayName: "AniList",
      pushWatched: async () => {
        throw new Error("network unavailable");
      },
    }),
    adapter({ isConnected: () => false }),
  );

  expect(await service.pushWatched(entry)).toEqual({
    connected: 1,
    succeeded: 0,
    failed: 1,
    failures: ["AniList: network unavailable"],
  });
});
