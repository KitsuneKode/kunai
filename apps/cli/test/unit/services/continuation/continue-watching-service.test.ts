import { expect, test } from "bun:test";

import { ContinueWatchingService } from "@/services/continuation/ContinueWatchingService";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

function makeRepo(): HistoryRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

test("projectTitle anchors on the most-recent episode for the title", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Example" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-05-02T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Example" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 300,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-05-03T00:00:00.000Z",
  });

  const service = new ContinueWatchingService(repo);
  const decision = service.projectTitle("tmdb:1");
  expect(decision.state).toBe("resume");
  expect(decision).toMatchObject({ episode: 3, positionSeconds: 300 });
});

test("recentRow returns one anchor per title, recency-ordered", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "a", kind: "series", title: "A" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "b", kind: "series", title: "B" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-04T00:00:00.000Z",
  });

  const service = new ContinueWatchingService(repo);
  const rows = service.recentRow(10);
  expect(rows.map((r) => r.titleId)).toEqual(["b", "a"]);
});

test("startupCandidate anchors on the most recent row and resumes unfinished progress", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 420,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.startupCandidate({ scanLimit: 50 });

  expect(decision?.state).toBe("resume");
  expect(decision?.primaryAction).toMatchObject({
    kind: "resume-online",
    target: { titleId: "tmdb:1", season: 1, episode: 3 },
  });
});

test("startupCandidate exposes offline-ready as local primary with online secondary", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.startupCandidate({
    signalsByTitle: () => ({
      offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 4, jobId: "job-4" }] },
    }),
  });

  expect(decision?.state).toBe("offline-ready");
  expect(decision?.primaryAction).toMatchObject({ kind: "play-local", jobId: "job-4" });
  expect(decision?.secondaryActions).toContainEqual(
    expect.objectContaining({
      kind: "select-online",
      target: expect.objectContaining({ episode: 4 }),
    }),
  );
});

test("titleDecision preserves stale freshness from release progress", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.titleDecision("tmdb:1", {
    releaseProgress: { newEpisodeCount: 2, stale: true },
  });

  expect(decision.state).toBe("new-episodes");
  expect(decision.badge).toBe("2 new");
  expect(decision.freshness).toBe("stale");
});

test("titleDecision resolves new-episodes to a concrete released playback target", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.titleDecision("tmdb:1", {
    releaseProgress: { newEpisodeCount: 2 },
    nextRelease: { season: 1, episode: 4, released: true },
  });

  expect(decision.state).toBe("new-episodes");
  expect(decision.target).toMatchObject({ season: 1, episode: 4 });
  expect(decision.primaryAction).toMatchObject({
    kind: "select-online",
    target: { season: 1, episode: 4 },
  });
});

test("titleDecision preserves airing-weekly availableAt metadata", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 5 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.titleDecision("tmdb:1", {
    nextRelease: {
      season: 1,
      episode: 6,
      released: false,
      availableAt: "2026-01-03T12:00:00.000Z",
    },
  });

  expect(decision).toMatchObject({
    state: "airing-weekly",
    availableAt: "2026-01-03T12:00:00.000Z",
  });
});

test("hubRows defaults local plus online availability to ask inline", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Demo" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const [row] = service.hubRows({
    signalsByTitle: () => ({
      offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 4, jobId: "job-4" }] },
    }),
  });

  expect(row?.group).toBe("offline-ready");
  expect(row?.sourceAvailability.kind).toBe("both-ready");
  expect(row?.primaryAction).toMatchObject({
    kind: "ask-inline",
    localAction: { kind: "play-local", jobId: "job-4" },
    onlineAction: { kind: "select-online", target: { season: 1, episode: 4 } },
  });
  expect(row?.secondaryActions.map((action) => action.kind)).toEqual([
    "play-local",
    "select-online",
    "queue",
    "mark-watched",
    "manage-offline",
  ]);
});

test("hubRows groups resume, new episodes, and tracked rows for the Continue Hub", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "resume", kind: "series", title: "Resume" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 420,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-01-04T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "new", kind: "series", title: "New" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "tracked", kind: "series", title: "Tracked" },
    episode: { season: 1, episode: 9 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const rows = service.hubRows({
    signalsByTitle: (titleId) =>
      titleId === "new"
        ? {
            releaseProgress: { newEpisodeCount: 1 },
            nextRelease: { season: 1, episode: 4, released: true },
          }
        : {},
  });

  expect(rows.map((row) => [row.id, row.group, row.badge])).toEqual([
    ["resume", "resume", "continue"],
    ["new", "new-episodes", "1 new"],
    ["tracked", "up-to-date", "tracked"],
  ]);
});

test("episodeProgress returns every stored episode for the title", () => {
  const repo = makeRepo();
  for (const episode of [1, 2, 3]) {
    repo.upsertProgress({
      title: { id: "tmdb:1", kind: "series", title: "Example" },
      episode: { season: 1, episode },
      positionSeconds: 100,
      durationSeconds: 1000,
      completed: false,
      updatedAt: `2026-05-0${episode}T00:00:00.000Z`,
    });
  }
  const service = new ContinueWatchingService(repo);
  expect(service.episodeProgress("tmdb:1").length).toBe(3);
});
