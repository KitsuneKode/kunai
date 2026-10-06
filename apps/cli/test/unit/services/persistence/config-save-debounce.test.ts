import { describe, expect, test } from "bun:test";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";

function createCountingStore() {
  let saves = 0;
  return {
    get saves() {
      return saves;
    },
    load: async () => ({ ...DEFAULT_CONFIG }),
    save: async () => {
      saves += 1;
    },
    reset: async () => {},
  };
}

describe("ConfigService.save debounce", () => {
  test("two rapid saves within the debounce window still persist exactly once", async () => {
    const store = createCountingStore();
    const service = await ConfigServiceImpl.load(store);

    // Fire two saves back-to-back (the previous implementation cancelled the
    // timer on the second call and never persisted).
    const first = service.save();
    const second = service.save();

    await Promise.all([first, second]);

    expect(store.saves).toBe(1);
  });

  test("a later save after a completed flush persists again", async () => {
    const store = createCountingStore();
    const service = await ConfigServiceImpl.load(store);

    await service.save();
    await service.save();

    expect(store.saves).toBe(2);
  });

  test("flushPending persists a pending save immediately without the debounce wait", async () => {
    const store = createCountingStore();
    const service = await ConfigServiceImpl.load(store);

    const startedAt = Date.now();
    const pending = service.save();
    await service.flushPending();
    await pending;

    expect(store.saves).toBe(1);
    // Must stay below the 300ms debounce window to prove flush bypassed it;
    // 280 leaves scheduler margin on loaded runners without losing the proof.
    expect(Date.now() - startedAt).toBeLessThan(280);
  });

  test("flushPending with nothing pending is a no-op", async () => {
    const store = createCountingStore();
    const service = await ConfigServiceImpl.load(store);

    await service.flushPending();

    expect(store.saves).toBe(0);
  });

  test("flushPending awaits a store write that is already in flight", async () => {
    // The shutdown race: once the debounce fires, `savePending` is null while
    // the store write is still running. `flushPending()` used to return there,
    // letting `process.exit()` truncate the write.
    let releaseSave!: () => void;
    let saves = 0;
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG }),
      save: () => {
        saves += 1;
        return new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);

    const pending = service.save();
    // Stands in for the debounce timer firing: the write starts and
    // `savePending` is cleared. The persist chain defers the store call by a
    // microtask, so drain once before expecting the write to be in flight.
    const started = service.flushPending();
    await drainMicrotasks();
    expect(saves).toBe(1);

    let lateFlushSettled = false;
    const lateFlush = service.flushPending().then(() => {
      lateFlushSettled = true;
      return null;
    });
    await drainMicrotasks();

    // Without the in-flight handle this is already true — shutdown would have
    // continued under a half-written config.json.
    expect(lateFlushSettled).toBe(false);

    releaseSave();
    await Promise.all([pending, started, lateFlush]);
    expect(lateFlushSettled).toBe(true);
    expect(saves).toBe(1);
  });

  test("store rejection rejects both save() and flushPending()", async () => {
    let rejectSave!: (reason: unknown) => void;
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG }),
      save: () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);

    const saved = service.save().then(
      () => null,
      (error: unknown) => error as Error,
    );
    const flushed = service.flushPending().then(
      () => null,
      (error: unknown) => error as Error,
    );
    await drainMicrotasks();
    rejectSave(new Error("disk full"));

    expect((await saved)?.message).toBe("disk full");
    expect((await flushed)?.message).toBe("disk full");
  });

  test("a save started mid-persist is not reverted by the first write's stale merge", async () => {
    // persist() merges dirty keys over a fresh store.load(). Unchained, a
    // second persist starting during that await merges over a snapshot that
    // predates the first write — and lands last, reverting it on disk.
    let nextLoadGate: Promise<void> | null = null;
    let onDisk: KitsuneConfig = { ...DEFAULT_CONFIG };
    const store = {
      load: () => {
        // Snapshot at call time — a real read can race a concurrent write and
        // return the pre-write bytes, which is exactly the hazard under test.
        const read = { ...onDisk };
        const gate = nextLoadGate ?? Promise.resolve();
        nextLoadGate = null;
        return gate.then(() => read);
      },
      save: (doc: KitsuneConfig) => {
        onDisk = { ...doc };
        return Promise.resolve();
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);

    // Boot may load more than once (read + migration merge-back), so arm the
    // gate after the service exists, not by call index.
    let releaseFirstPersistLoad!: () => void;
    nextLoadGate = new Promise<void>((resolve) => {
      releaseFirstPersistLoad = resolve;
    });
    await service.update({ provider: "allanime" });
    const firstSave = service.save();
    const firstFlush = service.flushPending();
    await drainMicrotasks();

    // Persist A is parked inside store.load(); persist B writes past it.
    // Both values are deliberately non-default — a revert to the pre-A
    // snapshot is only observable when the default does not hide it.
    await service.update({ downloadsEnabled: true });
    const secondSave = service.save();
    const secondFlush = service.flushPending();
    await drainMicrotasks();

    releaseFirstPersistLoad();
    await Promise.all([firstSave, firstFlush, secondSave, secondFlush]);

    // Whatever order the merges run in, both updates must survive to disk.
    expect(onDisk.provider).toBe("allanime");
    expect(onDisk.downloadsEnabled).toBe(true);
  });

  test("a synchronous store throw does not strand the in-flight handle", async () => {
    // `store.save()` throwing synchronously runs the catch and the finally before
    // `saveInFlight` was assigned, so assigning afterwards parked an
    // already-rejected promise there and every later flushPending() awaited it.
    let mode: "throw" | "ok" = "throw";
    let saves = 0;
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG }),
      save: () => {
        if (mode === "throw") throw new Error("disk full");
        saves += 1;
        return Promise.resolve();
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);

    await service.save().then(
      () => null,
      (error: unknown) => error,
    );

    // The failed write must not be left behind as a permanent flush target.
    mode = "ok";
    await service.flushPending();

    await service.save();
    expect(saves).toBe(1);
    await service.flushPending();
  });
});

/**
 * Drains the microtask queue. Not a timer: a `flushPending()` that returned
 * early settles within a microtask or two, so this makes the wrong behaviour
 * observable without waiting on the clock.
 */
async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}
