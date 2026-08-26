import { expect, test } from "bun:test";

import {
  dataMigrations,
  DownloadJobsRepository,
  openKunaiDatabase,
  runMigrations,
} from "../src/index";

test("provider episode identity migration preserves legacy download jobs", () => {
  const db = openKunaiDatabase(":memory:");
  const migrationIndex = dataMigrations.findIndex(
    (migration) => migration.id === "037_data_download_job_provider_episode_identity",
  );
  expect(migrationIndex).toBeGreaterThan(0);
  runMigrations(db, "data", dataMigrations.slice(0, migrationIndex));
  db.query(
    `INSERT INTO download_jobs (
      id, title_id, title_name, media_kind, provider_id, stream_url, headers_json,
      status, progress_percent, output_path, temp_path, error_message, retry_count,
      created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "legacy-job",
    "anilist:1",
    "Legacy Anime",
    "anime",
    "allanime",
    "",
    "{}",
    "queued",
    0,
    "/tmp/legacy.mp4",
    "/tmp/legacy.tmp",
    null,
    0,
    "2026-08-24T00:00:00.000Z",
    "2026-08-24T00:00:00.000Z",
    null,
  );

  runMigrations(db, "data", dataMigrations.slice(migrationIndex));

  expect(new DownloadJobsRepository(db).get("legacy-job")).toMatchObject({
    id: "legacy-job",
    providerEpisodeIdentity: undefined,
  });
  db.close();
});
