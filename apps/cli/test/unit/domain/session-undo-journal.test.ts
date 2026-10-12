import { describe, expect, test } from "bun:test";

import {
  sameUndoSnapshot,
  SessionUndoJournal,
  SESSION_UNDO_CAPACITY,
  SESSION_UNDO_WINDOW_MS,
  stableUndoJson,
} from "@/domain/undo/session-undo-journal";

const reverted = () => ({ kind: "reverted" }) as const;
const stale = (reason: string) => ({ kind: "stale", reason }) as const;

function makeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("SessionUndoJournal", () => {
  test("undo on an empty journal is a silent no-op", () => {
    const journal = new SessionUndoJournal();
    expect(journal.undo()).toEqual({ kind: "empty" });
    expect(journal.peek()).toBeUndefined();
  });

  test("undo pops the newest live entry (LIFO)", () => {
    const journal = new SessionUndoJournal();
    const order: string[] = [];
    journal.record({
      label: "first",
      undoNoun: "first",
      revert: () => (order.push("first"), reverted()),
    });
    journal.record({
      label: "second",
      undoNoun: "second",
      revert: () => (order.push("second"), reverted()),
    });

    const first = journal.undo();
    expect(first.kind).toBe("undone");
    expect(first.kind === "undone" ? first.entry.label : null).toBe("second");
    const second = journal.undo();
    expect(second.kind === "undone" ? second.entry.label : null).toBe("first");
    expect(order).toEqual(["second", "first"]);
    expect(journal.undo()).toEqual({ kind: "empty" });
  });

  test("peek exposes the newest live entry without consuming it", () => {
    const journal = new SessionUndoJournal();
    journal.record({ label: "a", undoNoun: "a", revert: reverted });
    journal.record({ label: "b", undoNoun: "b", revert: reverted });
    expect(journal.peek()?.label).toBe("b");
    expect(journal.peek()?.label).toBe("b");
    journal.undo();
    expect(journal.peek()?.label).toBe("a");
  });

  test("default capacity is the shipped bound", () => {
    const journal = new SessionUndoJournal();
    for (let i = 0; i < SESSION_UNDO_CAPACITY + 2; i += 1) {
      journal.record({ label: `e${i}`, undoNoun: `e${i}`, revert: reverted });
    }
    expect(journal.size()).toBe(SESSION_UNDO_CAPACITY);
    expect(journal.peek()?.label).toBe(`e${SESSION_UNDO_CAPACITY + 1}`);
  });

  test("capacity evicts the oldest entries first", () => {
    const journal = new SessionUndoJournal({ capacity: 3 });
    for (let i = 1; i <= 5; i += 1) {
      journal.record({ label: `e${i}`, undoNoun: `e${i}`, revert: reverted });
    }
    expect(journal.size()).toBe(3);
    const popped = [journal.undo(), journal.undo(), journal.undo()];
    const labels = popped.map((outcome) => (outcome.kind === "undone" ? outcome.entry.label : "?"));
    expect(labels).toEqual(["e5", "e4", "e3"]);
    expect(journal.undo()).toEqual({ kind: "empty" });
  });

  test("entries expire past the window — injected clock, no sleeps", () => {
    const clock = makeClock();
    const journal = new SessionUndoJournal({ now: clock.now });
    journal.record({ label: "a", undoNoun: "a", revert: reverted });
    clock.advance(SESSION_UNDO_WINDOW_MS - 1);
    expect(journal.peek()?.label).toBe("a");
    clock.advance(1);
    // At exactly expiresAt the window is over — the entry is gone.
    expect(journal.peek()).toBeUndefined();
    expect(journal.undo()).toEqual({ kind: "empty" });
  });

  test("expired entries prune lazily and newer live entries survive", () => {
    const clock = makeClock();
    const journal = new SessionUndoJournal({ now: clock.now });
    journal.record({ label: "old", undoNoun: "old", revert: reverted });
    clock.advance(SESSION_UNDO_WINDOW_MS + 1);
    journal.record({ label: "new", undoNoun: "new", revert: reverted });
    expect(journal.size()).toBe(1);
    const outcome = journal.undo();
    expect(outcome.kind === "undone" ? outcome.entry.label : null).toBe("new");
  });

  test("a stale revert reports skipped and the entry is still consumed", () => {
    const journal = new SessionUndoJournal();
    journal.record({
      label: "removed from queue",
      undoNoun: "queue remove",
      revert: () => stale("queue changed since then"),
    });
    const outcome = journal.undo();
    expect(outcome).toMatchObject({ kind: "skipped", reason: "queue changed since then" });
    expect(journal.undo()).toEqual({ kind: "empty" });
  });

  test("subscribers fire on record and on undo, never on peek", () => {
    const journal = new SessionUndoJournal();
    let calls = 0;
    const unsubscribe = journal.subscribe(() => {
      calls += 1;
    });
    journal.record({ label: "a", undoNoun: "a", revert: reverted });
    journal.peek();
    journal.undo();
    expect(calls).toBe(2);
    unsubscribe();
    journal.record({ label: "b", undoNoun: "b", revert: reverted });
    expect(calls).toBe(2);
  });

  test("entry ids stay monotonic across eviction", () => {
    const journal = new SessionUndoJournal({ capacity: 2 });
    journal.record({ label: "a", undoNoun: "a", revert: reverted });
    journal.record({ label: "b", undoNoun: "b", revert: reverted });
    const entry = journal.record({ label: "c", undoNoun: "c", revert: reverted });
    expect(entry.id).toBe(3);
    expect(journal.peek()?.id).toBe(3);
  });
});

describe("stableUndoJson / sameUndoSnapshot", () => {
  test("key order and dropped undefined fields do not create false drift", () => {
    expect(
      sameUndoSnapshot({ id: "a", title: "Show", season: undefined }, { title: "Show", id: "a" }),
    ).toBe(true);
  });

  test("array order is significant", () => {
    expect(sameUndoSnapshot([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameUndoSnapshot([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  test("nested structures compare structurally", () => {
    expect(
      stableUndoJson({ a: { b: [1, { c: 2 }] } }) === stableUndoJson({ a: { b: [1, { c: 2 }] } }),
    ).toBe(true);
    expect(sameUndoSnapshot({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameUndoSnapshot(undefined, null)).toBe(false);
    expect(sameUndoSnapshot(undefined, undefined)).toBe(true);
  });

  test("null and absent are distinct (a real DB NULL is not a missing key)", () => {
    expect(sameUndoSnapshot({ poster: null }, {})).toBe(false);
  });
});
