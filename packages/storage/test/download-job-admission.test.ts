import { afterEach, expect, test } from "bun:test";

import {
  dataMigrations,
  DownloadJobsRepository,
  openKunaiDatabase,
  runMigrations,
  type KunaiDatabase,
} from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function enqueueInput(
  id: string,
  overrides: Partial<Parameters<DownloadJobsRepository["enqueue"]>[0]> = {},
): Parameters<DownloadJobsRepository["enqueue"]>[0] {
  const now = "2026-08-24T00:00:00.000Z";
  return {
    id,
    titleId: "tmdb:series",
    titleName: "Example",
    mediaKind: "series",
    season: 1,
    episode: 1,
    providerId: "vidking",
    streamUrl: "",
    headers: {},
    outputPath: `/tmp/${id}.mp4`,
    tempPath: `/tmp/${id}.tmp`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("two repositories cannot admit the same blocking episode intent", () => {
  const directory = stores.dir("download-admission-two-repos");
  const firstDb = stores.db(directory, "data");
  const secondDb = openTrackedDatabase(directory);
  const first = new DownloadJobsRepository(firstDb);
  const second = new DownloadJobsRepository(secondDb);

  first.enqueue(enqueueInput("first"));

  expect(() => second.enqueue(enqueueInput("second"))).toThrow(
    "A blocking download intent already exists",
  );
  expect(first.listByTitle("tmdb:series", 10)).toHaveLength(1);
});

test("constraint translation does not reread mutable winner state", () => {
  class NoRereadDownloadJobsRepository extends DownloadJobsRepository {
    override findBlockingEpisodeIntent(): never {
      throw new Error("constraint translation must not reread the winning row");
    }
  }

  const directory = stores.dir("download-admission-no-reread");
  const first = new DownloadJobsRepository(stores.db(directory, "data"));
  const second = new NoRereadDownloadJobsRepository(openTrackedDatabase(directory));

  first.enqueue(enqueueInput("winner"));

  expect(() => second.enqueue(enqueueInput("loser"))).toThrow(
    "A blocking download intent already exists",
  );
});

test("nullable movie and unknown-season coordinates are part of the durable identity", () => {
  const repo = new DownloadJobsRepository(stores.store("download-admission-null", "data"));

  repo.enqueue(
    enqueueInput("movie", {
      titleId: "tmdb:movie",
      mediaKind: "movie",
      season: undefined,
      episode: undefined,
    }),
  );
  expect(() =>
    repo.enqueue(
      enqueueInput("movie-duplicate", {
        titleId: "tmdb:movie",
        mediaKind: "movie",
        season: undefined,
        episode: undefined,
      }),
    ),
  ).toThrow("A blocking download intent already exists");

  repo.enqueue(enqueueInput("unknown-season", { season: undefined, episode: 4 }));
  expect(() =>
    repo.enqueue(enqueueInput("unknown-season-duplicate", { season: undefined, episode: 4 })),
  ).toThrow("A blocking download intent already exists");

  expect(() => repo.enqueue(enqueueInput("different-episode", { episode: 2 }))).not.toThrow();
  expect(() =>
    repo.enqueue(enqueueInput("different-title", { titleId: "tmdb:other", episode: 1 })),
  ).not.toThrow();
});

test("failed and aborted rows release admission while completed rows keep it", () => {
  const repo = new DownloadJobsRepository(stores.store("download-admission-status", "data"));

  repo.enqueue(enqueueInput("failed"));
  repo.fail("failed", "terminal", false, "2026-08-24T00:01:00.000Z", "terminal");
  expect(() => repo.enqueue(enqueueInput("after-failed"))).not.toThrow();
  expect(() => repo.requeue("failed", "2026-08-24T00:01:30.000Z")).toThrow(
    "A blocking download intent already exists",
  );

  repo.abort("after-failed", "2026-08-24T00:02:00.000Z");
  repo.enqueue(enqueueInput("completed"));
  repo.complete("completed", "2026-08-24T00:03:00.000Z");
  expect(() => repo.enqueue(enqueueInput("after-completed"))).toThrow(
    "A blocking download intent already exists",
  );
});

test("the admission migration preserves the best completed artifact and quarantines duplicates", () => {
  const db = openKunaiDatabase(":memory:");
  const migrationIndex = dataMigrations.findIndex(
    (migration) => migration.id === "036_data_download_job_unique_intent",
  );
  expect(migrationIndex).toBeGreaterThan(0);
  runMigrations(db, "data", dataMigrations.slice(0, migrationIndex));

  const repo = new DownloadJobsRepository(db);
  repo.enqueue(
    enqueueInput("completed", {
      outputPath: "/media/example-ready.mp4",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    }),
  );
  repo.complete("completed", "2026-08-24T00:01:00.000Z");
  repo.enqueue(
    enqueueInput("invalid-newer", {
      outputPath: "/media/example-invalid.mp4",
      createdAt: "2026-08-24T00:01:30.000Z",
      updatedAt: "2026-08-24T00:01:30.000Z",
    }),
  );
  repo.complete("invalid-newer", "2026-08-24T00:02:00.000Z");
  repo.markArtifactValidated("invalid-newer", "invalid-file", "2026-08-24T00:02:30.000Z");
  repo.enqueue(
    enqueueInput("queued-newer", {
      outputPath: "/media/example-queued.mp4",
      createdAt: "2026-08-24T00:03:00.000Z",
      updatedAt: "2026-08-24T00:03:00.000Z",
    }),
  );

  runMigrations(db, "data");

  expect(repo.get("completed")).toMatchObject({
    status: "completed",
    artifactStatus: "ready",
    outputPath: "/media/example-ready.mp4",
  });
  expect(repo.get("queued-newer")).toMatchObject({
    status: "aborted",
    failureKind: "duplicate-intent-migrated",
    outputPath: "/media/example-queued.mp4",
  });
  expect(repo.get("invalid-newer")).toMatchObject({
    status: "aborted",
    artifactStatus: "invalid-file",
    failureKind: "duplicate-intent-migrated",
    outputPath: "/media/example-invalid.mp4",
  });
  expect(repo.listByTitle("tmdb:series", 10)).toHaveLength(3);
  expect(() => repo.enqueue(enqueueInput("post-migration"))).toThrow(
    "A blocking download intent already exists",
  );
  db.close();
});

function openTrackedDatabase(directory: string): KunaiDatabase {
  return stores.db(directory, "data");
}
