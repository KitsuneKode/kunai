import { expect, test } from "bun:test";

import { dataMigrations, OfflineAssetsRepository, openKunaiDatabase, runMigrations } from "../src";

test("provider episode identity migration preserves legacy offline assets", () => {
  const db = openKunaiDatabase(":memory:");
  const migrationIndex = dataMigrations.findIndex(
    (migration) => migration.id === "038_data_offline_asset_provider_episode_identity",
  );
  expect(migrationIndex).toBeGreaterThan(0);
  runMigrations(db, "data", dataMigrations.slice(0, migrationIndex));
  db.query(
    `INSERT INTO offline_assets (
      id, identity_key, title_id, title_name, media_kind, season, episode, profile_key,
      file_path, state, protected, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "legacy-asset",
    "anilist:1:anime:1:1:anime:sub:en:best",
    "anilist:1",
    "Legacy Anime",
    "anime",
    1,
    1,
    "anime:sub:en:best",
    "/tmp/legacy.mp4",
    "ready",
    0,
    "2026-08-24T00:00:00.000Z",
    "2026-08-24T00:00:00.000Z",
  );

  runMigrations(db, "data", dataMigrations.slice(migrationIndex));

  expect(new OfflineAssetsRepository(db).get("legacy-asset")).toMatchObject({
    id: "legacy-asset",
    providerEpisodeIdentity: undefined,
  });
  db.close();
});
