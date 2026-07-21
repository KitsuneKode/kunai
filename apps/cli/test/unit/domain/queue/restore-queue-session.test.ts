import { expect, test } from "bun:test";

import { QueueService } from "@/domain/queue/QueueService";
import { restoreQueueSessionWithResume } from "@/domain/queue/restore-queue-session";
import {
  openKunaiDatabase,
  QueueRepository,
  runMigrations,
  type HistoryProgress,
} from "@kunai/storage";

function historyRow(
  overrides: Partial<HistoryProgress> & Pick<HistoryProgress, "titleId">,
): HistoryProgress {
  return {
    key: `${overrides.titleId}:1:1`,
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 1,
    positionSeconds: 600,
    durationSeconds: 1400,
    completed: false,
    // Just inside the old session's window (it stopped at 01:00 on the 19th),
    // which is where a genuinely interrupted episode's checkpoint lands.
    updatedAt: "2026-07-19T00:59:00.000Z",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  } as HistoryProgress;
}

function setup(): { repo: QueueRepository; service: QueueService; close: () => void } {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "old-session",
    status: "recoverable",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T01:00:00.000Z",
    lastActivityAt: "2026-07-19T01:00:00.000Z",
  });
  repo.createQueueSession({
    id: "current-session",
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    lastActivityAt: "2026-07-20T00:00:00.000Z",
  });
  return { repo, service: new QueueService(repo, "current-session"), close: () => db.close() };
}

test("restore promotes the matching in-progress episode already in the restored session", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Queued Show",
    mediaKind: "series",
    titleId: "tmdb:99",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });
  const interrupted = repo.enqueue({
    title: "Interrupted Show",
    mediaKind: "series",
    titleId: "tmdb:42",
    season: 2,
    episode: 3,
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({ titleId: "tmdb:42", title: "Interrupted Show", season: 2, episode: 3 }),
      ],
    },
    "old-session",
  );

  expect(result.restoredCount).toBe(2);
  expect(result.resumeHead?.id).toBe(interrupted.id);
  expect(service.getUnplayed().map((entry) => entry.titleId)).toEqual(["tmdb:42", "tmdb:99"]);
  expect(service.peekNext()?.source).toBe("watchlist");
  close();
});

test("restore promotes a duplicate match rather than no-oping", () => {
  const { repo, service, close } = setup();
  const interrupted = repo.enqueue({
    title: "Interrupted Show",
    mediaKind: "series",
    titleId: "tmdb:42",
    season: 2,
    episode: 3,
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({ titleId: "tmdb:42", title: "Interrupted Show", season: 2, episode: 3 }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead?.id).toBe(interrupted.id);
  expect(service.getUnplayed()).toHaveLength(1);
  expect(service.peekNext()?.id).toBe(interrupted.id);
  close();
});

test("restore ignores finished and barely-started history rows", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Queued Show",
    mediaKind: "series",
    titleId: "tmdb:99",
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({ titleId: "tmdb:99", completed: true, updatedAt: "2026-07-19T00:58:00.000Z" }),
        historyRow({
          titleId: "tmdb:99",
          positionSeconds: 4,
          updatedAt: "2026-07-19T00:57:00.000Z",
        }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed().map((entry) => entry.titleId)).toEqual(["tmdb:99"]);
  close();
});

test("restore ignores history before session creation and after last activity + five minutes", () => {
  const { repo, service, close } = setup();
  const inSession = repo.enqueue({
    title: "In Session",
    mediaKind: "series",
    titleId: "tmdb:42",
    season: 2,
    episode: 3,
    source: "watchlist",
    sessionId: "old-session",
  });
  repo.enqueue({
    title: "Too Early",
    mediaKind: "series",
    titleId: "tmdb:early",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });
  repo.enqueue({
    title: "Too Late",
    mediaKind: "series",
    titleId: "tmdb:late",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });
  // Enqueue touches last_activity_at to wall-clock now; pin the session window.
  repo.createQueueSession({
    id: "old-session",
    status: "recoverable",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T01:00:00.000Z",
    lastActivityAt: "2026-07-19T01:00:00.000Z",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({
          titleId: "tmdb:early",
          updatedAt: "2026-07-18T23:00:00.000Z",
        }),
        historyRow({
          titleId: "tmdb:late",
          updatedAt: "2026-07-19T01:10:00.000Z",
        }),
        historyRow({
          titleId: "tmdb:42",
          title: "In Session",
          season: 2,
          episode: 3,
          updatedAt: "2026-07-19T00:59:00.000Z",
        }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead?.id).toBe(inSession.id);
  expect(service.peekNext()?.titleId).toBe("tmdb:42");
  close();
});

test("restore ignores unrelated title identity and absolute episode mismatch", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Anime A",
    mediaKind: "anime",
    titleId: "anilist:1",
    absoluteEpisode: 13,
    source: "watchlist",
    sessionId: "old-session",
  });
  repo.enqueue({
    title: "Other Show",
    mediaKind: "series",
    titleId: "tmdb:other",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({
          titleId: "tmdb:unrelated",
          title: "Unrelated Movie",
          mediaKind: "movie",
          season: undefined,
          episode: undefined,
          updatedAt: "2026-07-19T00:59:00.000Z",
        }),
        historyRow({
          titleId: "anilist:1",
          title: "Anime A",
          mediaKind: "anime",
          season: undefined,
          episode: undefined,
          absoluteEpisode: 12,
          updatedAt: "2026-07-19T00:58:00.000Z",
        }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed().map((entry) => entry.titleId)).toEqual(["anilist:1", "tmdb:other"]);
  close();
});

test("queue-owned in-flight identity takes precedence over history", () => {
  const { repo, service, close } = setup();
  const pending = repo.enqueue({
    title: "History Match",
    mediaKind: "series",
    titleId: "tmdb:history",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });
  const inFlight = repo.enqueue({
    title: "In Flight",
    mediaKind: "series",
    titleId: "tmdb:inflight",
    season: 1,
    episode: 2,
    source: "watchlist",
    sessionId: "old-session",
  });
  expect(repo.markInFlight(inFlight.id, "old-session", "2026-07-19T00:55:00.000Z")).toBe(true);

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({
          titleId: "tmdb:history",
          season: 1,
          episode: 1,
          updatedAt: "2026-07-19T00:59:00.000Z",
        }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead?.id).toBe(inFlight.id);
  expect(result.resumeHead?.id).not.toBe(pending.id);
  expect(service.peekNext()?.titleId).toBe("tmdb:inflight");
  expect(repo.getById(inFlight.id)?.status).toBe("pending");
  close();
});

test("restore places the restored block between current played and current pending", () => {
  const { repo, service, close } = setup();
  const playedCurrent = repo.enqueue({
    title: "played-current",
    mediaKind: "series",
    titleId: "played-current",
    source: "manual",
    sessionId: "current-session",
  });
  repo.markPlayed(playedCurrent.id);
  repo.enqueue({
    title: "current-a",
    mediaKind: "series",
    titleId: "current-a",
    source: "manual",
    sessionId: "current-session",
  });
  repo.enqueue({
    title: "current-b",
    mediaKind: "series",
    titleId: "current-b",
    source: "manual",
    sessionId: "current-session",
  });
  repo.enqueue({
    title: "restored-a",
    mediaKind: "series",
    titleId: "restored-a",
    source: "watchlist",
    sessionId: "old-session",
  });
  repo.enqueue({
    title: "restored-b",
    mediaKind: "series",
    titleId: "restored-b",
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [],
    },
    "old-session",
  );

  expect(result.restoredCount).toBe(2);
  expect(service.getAll().map((entry) => entry.titleId)).toEqual([
    "played-current",
    "restored-a",
    "restored-b",
    "current-a",
    "current-b",
  ]);
  close();
});

test("in-flight shutdown recovery restores the exact row as pending", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "crashed",
    status: "active",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  });
  const entry = repo.enqueue({
    title: "Interrupted",
    mediaKind: "anime",
    titleId: "anilist:9",
    absoluteEpisode: 7,
    source: "manual",
    sessionId: "crashed",
  });
  const crashed = new QueueService(repo, "crashed");
  expect(crashed.beginPlayback(entry.id, "queue", "2026-07-19T00:30:00.000Z")).toBeDefined();
  expect(crashed.prepareForShutdown("2026-07-19T00:31:00.000Z")).toBe("recoverable");
  expect(repo.getById(entry.id)?.status).toBe("in-flight");

  repo.createQueueSession({
    id: "fresh",
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  });
  const fresh = new QueueService(repo, "fresh");
  const result = restoreQueueSessionWithResume(
    {
      queue: fresh,
      readHistory: () => [],
    },
    "crashed",
  );

  expect(result.restoredCount).toBe(1);
  expect(result.resumeHead?.id).toBe(entry.id);
  expect(repo.getById(entry.id)?.status).toBe("pending");
  expect(fresh.peekNext()?.absoluteEpisode).toBe(7);
  db.close();
});

test("restore of an unrecoverable session changes nothing", () => {
  const { service, close } = setup();

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [historyRow({ titleId: "tmdb:42" })],
    },
    "does-not-exist",
  );

  expect(result.restoredCount).toBe(0);
  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed()).toHaveLength(0);
  close();
});

test("history inference never invents a row that was not in the restored session", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Queued Show",
    mediaKind: "series",
    titleId: "tmdb:99",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({ titleId: "tmdb:42", title: "Interrupted Show", season: 2, episode: 3 }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed().map((entry) => entry.titleId)).toEqual(["tmdb:99"]);
  close();
});
