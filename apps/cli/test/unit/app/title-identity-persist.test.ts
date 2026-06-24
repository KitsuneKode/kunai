import { expect, test } from "bun:test";

import { persistProviderNativeMapping } from "@/app/bootstrap/title-identity-persist";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

test("persistProviderNativeMapping backfills providerNativeIds on canonical title id", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);

  repo.upsertProgress({
    title: {
      id: "20431",
      kind: "anime",
      title: "Hozuki",
      externalIds: { anilistId: "20431" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 120,
    providerId: "allanime",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });

  persistProviderNativeMapping(
    repo,
    {
      id: "bxCKTopaque",
      type: "series",
      name: "Hozuki",
      isAnime: true,
      externalIds: { anilistId: "20431" },
    },
    "allanime",
    "bxCKTopaque",
    "anime",
  );

  const latest = repo.getLatestForTitle("20431");
  expect(latest?.externalIds?.providerNativeIds?.allanime).toBe("bxCKTopaque");
});
