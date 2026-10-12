import { describe, expect, test } from "bun:test";

import { sameUndoSnapshot } from "@/domain/undo/session-undo-journal";
import { SessionUndoService } from "@/services/session-undo/session-undo-service";
import {
  FollowedTitleRepository,
  HistoryRepository,
  ListRepository,
  openKunaiDatabase,
  QueueRepository,
  runMigrations,
} from "@kunai/storage";

const SESSION_ID = "session-under-test";

function makeStack(now?: () => number) {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const queueRepository = new QueueRepository(db);
  const listRepository = new ListRepository(db);
  const followedTitleRepository = new FollowedTitleRepository(db);
  const historyRepository = new HistoryRepository(db);
  queueRepository.createQueueSession({
    id: SESSION_ID,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const sessionUndo = new SessionUndoService({
    queueRepository,
    queueSessionId: SESSION_ID,
    listRepository,
    followedTitleRepository,
    historyRepository,
    now,
  });
  return {
    db,
    queueRepository,
    listRepository,
    followedTitleRepository,
    historyRepository,
    sessionUndo,
  };
}

const queueInput = (titleId: string) => ({
  title: `Title ${titleId}`,
  mediaKind: "series" as const,
  titleId,
  source: "manual" as const,
  sessionId: SESSION_ID,
});

describe("SessionUndoService — queue", () => {
  test("queue add undoes to the exact prior state", () => {
    const { queueRepository, sessionUndo } = makeStack();
    queueRepository.enqueue(queueInput("a"));

    const before = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("b"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before);

    expect(sessionUndo.hasLiveUndo()).toBe(true);
    expect(sessionUndo.peekStrip(Date.now())?.text).toBe("added to queue · z undo");

    const outcome = sessionUndo.undoLatest();
    expect(outcome.kind).toBe("undone");
    const rows = queueRepository.getAll(SESSION_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.titleId).toBe("a");
    expect(sameUndoSnapshot(rows, before)).toBe(true);
    expect(sessionUndo.hasLiveUndo()).toBe(false);
  });

  test("queue remove restores the row with its exact id, position, and fields", () => {
    const { queueRepository, sessionUndo } = makeStack();
    const a = queueRepository.enqueue(queueInput("a"));
    const b = queueRepository.enqueue(queueInput("b"));
    const c = queueRepository.enqueue(queueInput("c"));
    queueRepository.setQueuePositions([a.id, b.id, c.id]);
    const bPositioned = queueRepository.getById(b.id);

    const before = sessionUndo.captureQueue();
    queueRepository.remove(b.id);
    sessionUndo.recordQueueChange("removed from queue", "queue remove", before);

    const outcome = sessionUndo.undoLatest();
    expect(outcome.kind).toBe("undone");
    const restored = queueRepository.getById(b.id);
    // Whole-row equality: same id, same queue_position, same added_at — the
    // state the user had, not an equivalent re-enqueue.
    expect(sameUndoSnapshot(restored, bPositioned)).toBe(true);
    expect(sameUndoSnapshot(queueRepository.getAll(SESSION_ID), before)).toBe(true);
  });

  test("queue reorder undoes exact queue_position values", () => {
    const { queueRepository, sessionUndo } = makeStack();
    const a = queueRepository.enqueue(queueInput("a"));
    const b = queueRepository.enqueue(queueInput("b"));
    const c = queueRepository.enqueue(queueInput("c"));
    queueRepository.setQueuePositions([a.id, b.id, c.id]);

    const before = sessionUndo.captureQueue();
    queueRepository.setQueuePositions([c.id, a.id, b.id]);
    sessionUndo.recordQueueChange("reordered queue", "queue reorder", before);

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    const rows = queueRepository.getAll(SESSION_ID);
    const positions = new Map(rows.map((row) => [row.id, row.queuePosition]));
    expect(positions.get(a.id)).toBe(0);
    expect(positions.get(b.id)).toBe(1);
    expect(positions.get(c.id)).toBe(2);
    expect(sameUndoSnapshot(rows, before)).toBe(true);
  });

  test("queue clear restores every row", () => {
    const { queueRepository, sessionUndo } = makeStack();
    queueRepository.enqueue(queueInput("a"));
    queueRepository.enqueue(queueInput("b"));

    const before = sessionUndo.captureQueue();
    queueRepository.clear(SESSION_ID);
    sessionUndo.recordQueueChange("cleared queue", "queue clear", before);
    expect(queueRepository.getAll(SESSION_ID)).toHaveLength(0);

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(sameUndoSnapshot(queueRepository.getAll(SESSION_ID), before)).toBe(true);
  });

  test("a no-op mutation records nothing", () => {
    const { queueRepository, sessionUndo } = makeStack();
    queueRepository.enqueue(queueInput("a"));
    const before = sessionUndo.captureQueue();
    sessionUndo.recordQueueChange("nothing changed", "noop", before);
    expect(sessionUndo.hasLiveUndo()).toBe(false);
    expect(sessionUndo.peekStrip(Date.now())).toBeNull();
  });

  test("undo is itself never journaled", () => {
    const { queueRepository, sessionUndo } = makeStack();
    const before = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("a"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before);
    sessionUndo.undoLatest();
    // A second z now sees an empty journal — the undo created no new entry.
    expect(sessionUndo.undoLatest()).toEqual({ kind: "empty" });
    expect(queueRepository.getAll(SESSION_ID)).toHaveLength(0);
  });

  test("a row changed after the mutation pops-and-skips with honest copy", () => {
    const { queueRepository, sessionUndo } = makeStack();
    const a = queueRepository.enqueue(queueInput("a"));
    const b = queueRepository.enqueue(queueInput("b"));

    const before = sessionUndo.captureQueue();
    queueRepository.remove(b.id);
    sessionUndo.recordQueueChange("removed from queue", "queue remove", before);

    // The entity changed elsewhere after the journal entry: a is now played.
    queueRepository.markPlayed(a.id);

    const outcome = sessionUndo.undoLatest();
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toContain("changed");
    }
    // Newer state is left untouched — b stays removed, a stays played.
    expect(queueRepository.getById(b.id)).toBeUndefined();
    expect(queueRepository.getById(a.id)?.status).toBe("played");
    // The strip says why instead of pretending.
    expect(sessionUndo.peekStrip(Date.now())?.text).toContain("can't undo");
  });

  test("withQueueChange returns the wrapped result and records once", () => {
    const { queueRepository, sessionUndo } = makeStack();
    const result = sessionUndo.withQueueChange("added to queue", "queue add", () => {
      queueRepository.enqueue(queueInput("a"));
      return 42;
    });
    expect(result).toBe(42);
    expect(sessionUndo.hasLiveUndo()).toBe(true);
    sessionUndo.undoLatest();
    expect(sessionUndo.undoLatest()).toEqual({ kind: "empty" });
    expect(queueRepository.getAll(SESSION_ID)).toHaveLength(0);
  });
});

describe("SessionUndoService — lists", () => {
  test("watchlist add undoes by removing the new row", () => {
    const { listRepository, sessionUndo } = makeStack();
    const before = sessionUndo.captureListItem("watchlist", "t1");
    listRepository.addItem({
      listId: "watchlist",
      titleId: "t1",
      mediaKind: "series",
      title: "Show One",
    });
    sessionUndo.recordListItem("watchlist", "t1", "added to watchlist", "watchlist save", before);

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(listRepository.getItemByTitle("watchlist", "t1")).toBeUndefined();
  });

  test("watchlist remove restores the exact row — id, sort order, timestamps", () => {
    const { listRepository, sessionUndo } = makeStack();
    const item = listRepository.addItem({
      listId: "watchlist",
      titleId: "t1",
      mediaKind: "series",
      title: "Show One",
    });

    const before = sessionUndo.captureListItem("watchlist", "t1");
    listRepository.removeItemByTitle("watchlist", "t1");
    sessionUndo.recordListItem(
      "watchlist",
      "t1",
      "removed from watchlist",
      "watchlist remove",
      before,
    );

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    const restored = listRepository.getItemByTitle("watchlist", "t1");
    expect(sameUndoSnapshot(restored, item)).toBe(true);
  });

  test("favorites toggle undo restores membership both directions", () => {
    const { listRepository, sessionUndo } = makeStack();

    // absent → present → undo → absent
    let before = sessionUndo.captureListItem("favorites", "t1");
    listRepository.addItem({
      listId: "favorites",
      titleId: "t1",
      mediaKind: "movie",
      title: "Film",
    });
    sessionUndo.recordListItem("favorites", "t1", "added to favorites", "favorite add", before);
    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(listRepository.getItemByTitle("favorites", "t1")).toBeUndefined();

    // present → absent → undo → present (exact row)
    const item = listRepository.addItem({
      listId: "favorites",
      titleId: "t1",
      mediaKind: "movie",
      title: "Film",
    });
    before = sessionUndo.captureListItem("favorites", "t1");
    listRepository.removeItemByTitle("favorites", "t1");
    sessionUndo.recordListItem(
      "favorites",
      "t1",
      "removed from favorites",
      "favorite remove",
      before,
    );
    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(sameUndoSnapshot(listRepository.getItemByTitle("favorites", "t1"), item)).toBe(true);
  });
});

describe("SessionUndoService — followed titles", () => {
  test("follow on an unfollowed title deletes the created row on undo", () => {
    const { followedTitleRepository, sessionUndo } = makeStack();
    sessionUndo.withFollowed("t1", "followed title", "follow", () =>
      followedTitleRepository.upsert({
        titleId: "t1",
        mediaKind: "series",
        title: "Show",
        preference: "following",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(followedTitleRepository.get("t1")?.preference).toBe("following");
    expect(sessionUndo.undoLatest().kind).toBe("undone");
    // Absence restores as absence — no synthetic `implicit` row left behind.
    expect(followedTitleRepository.get("t1")).toBeUndefined();
  });

  test("a preference change restores the exact prior record", () => {
    const { followedTitleRepository, sessionUndo } = makeStack();
    const muted = followedTitleRepository.upsert({
      titleId: "t1",
      mediaKind: "series",
      title: "Show",
      preference: "muted",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    sessionUndo.withFollowed("t1", "followed title", "follow", () =>
      followedTitleRepository.upsert({ ...muted, preference: "following" }),
    );

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(sameUndoSnapshot(followedTitleRepository.get("t1"), muted)).toBe(true);
  });
});

describe("SessionUndoService — history", () => {
  const title = { id: "t1", kind: "series" as const, title: "Show" };
  const episode = { season: 1, episode: 3 };

  test("markWatched on a fresh row deletes it on undo", () => {
    const { historyRepository, sessionUndo } = makeStack();
    sessionUndo.withHistory("marked watched", "watched mark", () =>
      historyRepository.markWatched(title, episode),
    );
    expect(historyRepository.getProgress(title, episode)?.completed).toBe(true);
    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(historyRepository.getProgress(title, episode)).toBeUndefined();
  });

  test("markWatched over an in-progress row restores every field exactly", () => {
    const { historyRepository, sessionUndo } = makeStack();
    historyRepository.upsertProgress({
      title,
      episode,
      positionSeconds: 512,
      durationSeconds: 1_400,
      watchedSeconds: 512,
      completed: false,
    });
    const before = historyRepository.getProgress(title, episode);
    expect(before?.completed).toBe(false);
    expect(before?.positionSeconds).toBe(512);

    sessionUndo.withHistory("marked watched", "watched mark", () =>
      historyRepository.markWatched(title, episode),
    );
    expect(historyRepository.getProgress(title, episode)?.completed).toBe(true);

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    const restored = historyRepository.getProgress(title, episode);
    // Full-row equality — created_at, updated_at, last_watched_at, completed_at,
    // provider, external ids, poster: undo lands the row the user had.
    expect(sameUndoSnapshot(restored, before)).toBe(true);
  });

  test("episode-progress delete restores the row verbatim", () => {
    const { historyRepository, sessionUndo } = makeStack();
    historyRepository.upsertProgress({
      title,
      episode,
      positionSeconds: 100,
      durationSeconds: 900,
      watchedSeconds: 100,
      completed: false,
    });
    const row = historyRepository.getProgress(title, episode);

    const before = sessionUndo.captureHistory();
    historyRepository.deleteProgressByKey(row?.key ?? "");
    sessionUndo.recordHistoryChange("deleted episode progress", "history delete", before);

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(sameUndoSnapshot(historyRepository.getProgress(title, episode), row)).toBe(true);
  });

  test("season-watched bulk mark undoes every changed row", () => {
    const { historyRepository, sessionUndo } = makeStack();
    const before = sessionUndo.captureHistory();
    for (let ep = 1; ep <= 3; ep += 1) {
      historyRepository.markWatched(title, { season: 1, episode: ep });
    }
    sessionUndo.recordHistoryChange("marked 3 episode(s) watched", "season watched mark", before);
    expect(historyRepository.listAllProgress()).toHaveLength(3);

    expect(sessionUndo.undoLatest().kind).toBe("undone");
    expect(historyRepository.listAllProgress()).toHaveLength(0);
  });

  test("a history row changed after the mutation skips instead of overwriting", () => {
    const { historyRepository, sessionUndo } = makeStack();
    historyRepository.upsertProgress({
      title,
      episode,
      positionSeconds: 10,
      completed: false,
    });

    sessionUndo.withHistory("marked watched", "watched mark", () =>
      historyRepository.markWatched(title, episode),
    );

    // The entity moved on: playback wrote new progress after the mark.
    historyRepository.upsertProgress({
      title,
      episode,
      positionSeconds: 800,
      durationSeconds: 1_400,
      watchedSeconds: 800,
      completed: false,
    });

    const outcome = sessionUndo.undoLatest();
    expect(outcome.kind).toBe("skipped");
    // The newer write survives — undo refused to rewind it.
    expect(historyRepository.getProgress(title, episode)?.positionSeconds).toBe(800);
  });
});

describe("SessionUndoService — strip + window", () => {
  test("peekStrip prefers the outcome line briefly, then falls back", () => {
    let now = 5_000_000;
    const { queueRepository, sessionUndo } = makeStack(() => now);
    const before = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("a"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before);

    expect(sessionUndo.peekStrip(now)?.text).toBe("added to queue · z undo");
    sessionUndo.undoLatest();
    expect(sessionUndo.peekStrip(now)?.text).toBe("undid queue add");
    expect(sessionUndo.peekStrip(now)?.tone).toBe("success");
    // The outcome line expires independently and then nothing is left.
    now += 5_000;
    expect(sessionUndo.peekStrip(now)).toBeNull();
  });

  test("entries expire past the journal window — z becomes a no-op", () => {
    let now = 5_000_000;
    const { queueRepository, sessionUndo } = makeStack(() => now);
    const before = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("a"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before);

    now += 9_000;
    expect(sessionUndo.hasLiveUndo()).toBe(false);
    expect(sessionUndo.peekStrip(now)).toBeNull();
    expect(sessionUndo.undoLatest()).toEqual({ kind: "empty" });
    // And the expired entry does not come back to haunt the queue.
    expect(queueRepository.getAll(SESSION_ID)).toHaveLength(1);
  });

  test("a fresh action supersedes a still-showing outcome line", () => {
    let now = 5_000_000;
    const { queueRepository, sessionUndo } = makeStack(() => now);
    const before = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("a"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before);
    sessionUndo.undoLatest();
    expect(sessionUndo.peekStrip(now)?.text).toBe("undid queue add");

    const before2 = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("b"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before2);
    expect(sessionUndo.peekStrip(now)?.text).toBe("added to queue · z undo");
  });

  test("subscribers fire on record and on undo", () => {
    const { queueRepository, sessionUndo } = makeStack();
    let calls = 0;
    sessionUndo.subscribe(() => {
      calls += 1;
    });
    const before = sessionUndo.captureQueue();
    queueRepository.enqueue(queueInput("a"));
    sessionUndo.recordQueueChange("added to queue", "queue add", before);
    sessionUndo.undoLatest();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
