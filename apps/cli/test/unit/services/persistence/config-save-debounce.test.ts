import { describe, expect, test } from "bun:test";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

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
    // `savePending` is cleared.
    const started = service.flushPending();
    // The write re-reads the file before saving (the cross-process merge), so
    // `store.save` is called one async hop after flushPending returns.
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
    // The write re-reads the file first, so `store.save` runs a hop later.
    await drainMicrotasks();
    rejectSave(new Error("disk full"));

    expect((await saved)?.message).toBe("disk full");
    expect((await flushed)?.message).toBe("disk full");
  });

  test("a mid-flight reload cannot swap in-flight keys back to disk values", async () => {
    // `maybePing` runs reloadFromDisk() while a save sits inside its
    // load→write window. The save had already cleared `dirtyKeys`, so the
    // reload saw the in-flight keys as untouched and replaced their values in
    // `this.config` with disk data — the resumed write then persisted the old
    // values and the local change was lost.
    let releaseSaveLoad!: () => void;
    let loadCalls = 0;
    const written: KitsuneConfig[] = [];
    const store = {
      load: (): Promise<Partial<KitsuneConfig>> => {
        loadCalls += 1;
        // Call 1 boots the service; call 2 is the save's pre-write read and
        // blocks on the latch; the reload's read resolves immediately.
        if (loadCalls === 2) {
          return new Promise<void>((resolve) => {
            releaseSaveLoad = resolve;
          }).then(() => ({ ...DEFAULT_CONFIG, analytics: "enabled" as const }));
        }
        return Promise.resolve({ ...DEFAULT_CONFIG, analytics: "enabled" as const });
      },
      save: (config: KitsuneConfig) => {
        written.push(config);
        return Promise.resolve();
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    await service.update({ analytics: "disabled" });

    const pending = service.save();
    const started = service.flushPending();
    await drainMicrotasks();
    // The save is parked inside its pre-write load().

    await service.reloadFromDisk();

    releaseSaveLoad();
    await Promise.all([pending, started]);

    expect(service.analytics).toBe("disabled");
    expect(written.at(-1)?.analytics).toBe("disabled");
  });

  test("overlapping saves serialize their load→write runs", async () => {
    // A save() whose debounce fired while a write was in flight used to start
    // a second run over the same disk base — the second write dropped the
    // keys the first had just persisted, and each run clobbered the other's
    // shared inFlightValues snapshot.
    let releaseFirstLoad!: () => void;
    let loadCalls = 0;
    const written: KitsuneConfig[] = [];
    const store = {
      load: (): Promise<Partial<KitsuneConfig>> => {
        loadCalls += 1;
        // Call 1 boots the service; call 2 is the first save's pre-write
        // read and parks on the latch; the second save's read must not start
        // until the first run fully settles.
        if (loadCalls === 2) {
          return new Promise<void>((resolve) => {
            releaseFirstLoad = resolve;
          }).then(() => ({ ...DEFAULT_CONFIG }));
        }
        return Promise.resolve({ ...DEFAULT_CONFIG });
      },
      save: (config: KitsuneConfig) => {
        written.push(config);
        return Promise.resolve();
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    await service.update({ analytics: "disabled" });

    const first = service.save();
    const firstFlush = service.flushPending();
    await drainMicrotasks();
    expect(loadCalls).toBe(2);

    // A newer value for the same key lands while the first write is parked.
    await service.update({ analytics: "enabled" });
    const second = service.save();
    const secondFlush = service.flushPending();
    await drainMicrotasks();

    // Serialized: the second run waits on the first tail instead of opening
    // its own load→write window over the same disk base.
    expect(loadCalls).toBe(2);
    expect(written).toHaveLength(0);

    releaseFirstLoad();
    await Promise.all([first, second, firstFlush, secondFlush]);

    expect(written.map((config) => config.analytics)).toEqual(["disabled", "enabled"]);
    expect(service.analytics).toBe("enabled");
  });

  test("a failed save keeps a mid-flight newer value for the same key", async () => {
    // update() during the parked write dirties the same key the snapshot
    // holds. Restoring the snapshot over it (without re-applying dirty keys)
    // left the retry persisting the stale value.
    let rejectSave!: (reason: unknown) => void;
    let mode: "fail" | "ok" = "fail";
    const written: KitsuneConfig[] = [];
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG }),
      save: (config: KitsuneConfig) => {
        if (mode === "ok") {
          written.push(config);
          return Promise.resolve();
        }
        return new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        });
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    await service.update({ analytics: "disabled" });

    const pending = service.save().then(
      () => "resolved",
      () => "rejected",
    );
    const flushed = service.flushPending().then(
      () => "resolved",
      () => "rejected",
    );
    await drainMicrotasks();

    await service.update({ analytics: "enabled" });
    rejectSave(new Error("disk full"));
    await Promise.all([pending, flushed]);

    // The newer value survives the restore and is what the retry persists.
    expect(service.analytics).toBe("enabled");
    mode = "ok";
    const retry = service.save();
    await service.flushPending();
    await retry;
    expect(written.at(-1)?.analytics).toBe("enabled");
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
