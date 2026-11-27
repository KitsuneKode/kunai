import { expect, test } from "bun:test";

import { ContinueWatchingService } from "@/services/continuation/ContinueWatchingService";
import { cachedContinuationSignals } from "@/services/continuation/history-continuation-signals";
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

test("startupCandidate skips a finished newest title and continues the unfinished one behind it", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:show", kind: "series", title: "Show" },
    episode: { season: 2, episode: 5 },
    positionSeconds: 600,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  // Watched to the end afterwards: the newest title, with nothing left to play.
  repo.upsertProgress({
    title: { id: "tmdb:movie", kind: "movie", title: "Movie" },
    positionSeconds: 7000,
    durationSeconds: 7000,
    completed: true,
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.startupCandidate({ scanLimit: 100 });

  expect(decision?.primaryAction).toMatchObject({
    kind: "resume-online",
    target: { titleId: "tmdb:show", season: 2, episode: 5 },
  });
});

test("startupCandidate returns nothing when no recent title has anything to play", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:movie", kind: "movie", title: "Movie" },
    positionSeconds: 7000,
    durationSeconds: 7000,
    completed: true,
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  expect(new ContinueWatchingService(repo).startupCandidate()).toBeNull();
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

test("titleDecision exposes dual local and online actions for projection-backed source choice", () => {
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
    offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 4, jobId: "job-4" }] },
  });

  expect(decision.state).toBe("offline-ready");
  expect(decision.primaryAction).toMatchObject({ kind: "play-local", jobId: "job-4" });
  expect(decision.secondaryActions?.map((action) => action.kind)).toContain("select-online");
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

test("projectTitle via HistoryTitleLookup resolves bare TMDB id to tmdb: rows", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: {
      id: "tmdb:42",
      kind: "series",
      title: "Demo",
      externalIds: { tmdbId: "42" },
    },
    episode: { season: 1, episode: 4 },
    positionSeconds: 250,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-05-03T00:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);

  const decision = service.projectTitle({
    id: "42",
    kind: "series",
    title: "Demo",
    externalIds: { tmdbId: "42" },
  });

  expect(decision.state).toBe("resume");
  expect(decision).toMatchObject({ titleId: "tmdb:42", episode: 4, positionSeconds: 250 });
});

test("--continue after a finished episode starts the next aired one from the release cache", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Binge" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 1400,
    durationSeconds: 1400,
    completed: true,
    updatedAt: "2026-11-20T10:00:00.000Z",
  });
  const service = new ContinueWatchingService(repo);
  // Reconciliation reports an old backlog as caught-up; episode 10 has aired.
  const releaseProgress = {
    titleId: "tmdb:1",
    mediaKind: "series" as const,
    source: "tmdb" as const,
    title: "Binge",
    anchorSeason: 1,
    anchorEpisode: 3,
    latestAiredSeason: 1,
    latestAiredEpisode: 10,
    newEpisodeCount: 0,
    status: "caught-up" as const,
    checkedAt: "2026-11-20T11:00:00.000Z",
    nextCheckAt: "2026-11-21T11:00:00.000Z",
    staleAfterAt: "2999-01-01T00:00:00.000Z",
    sourceFingerprint: "series:10",
    errorCount: 0,
  };

  const decision = service.startupCandidate({
    signalsByTitle: (_titleId, anchor) =>
      cachedContinuationSignals({ entry: anchor, releaseProgress }),
  });

  expect(decision?.state).toBe("next-up");
  expect(decision?.target).toMatchObject({ season: 1, episode: 4 });
  expect(decision?.primaryAction?.kind).toBe("select-online");
});

test("--continue skips a row at the resume floor for the next title with something to play", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:older", kind: "series", title: "Older" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 400,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-11-19T10:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "tmdb:new", kind: "series", title: "Barely Started" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 8,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-11-20T10:00:00.000Z",
  });

  const decision = new ContinueWatchingService(repo).startupCandidate();

  expect(decision?.target).toMatchObject({ titleId: "tmdb:older", episode: 2 });
});
