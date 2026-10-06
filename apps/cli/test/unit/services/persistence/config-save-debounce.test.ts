import { describe, expect, test } from "bun:test";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "@/services/persistence/credential-vault";

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

  test("a key re-dirtied while its save was in flight still reaches disk on the next save", async () => {
    // The merge write snapshots each dirty value at persist start. If update()
    // lands while store.load() is parked, clearing the flag unconditionally
    // would drop the newer value — the next save must still carry it.
    let nextLoadGate: Promise<void> | null = null;
    let onDisk: KitsuneConfig = { ...DEFAULT_CONFIG };
    const store = {
      load: () => {
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

    await service.update({ provider: "first-value" });
    const pending = service.save();
    let release!: () => void;
    nextLoadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flushed = service.flushPending();
    await drainMicrotasks();

    await service.update({ provider: "second-value" });
    release();
    await Promise.all([pending, flushed]);
    expect(onDisk.provider).toBe("first-value");

    const second = service.save();
    await service.flushPending();
    await second;
    expect(onDisk.provider).toBe("second-value");
  });

  test("a save with nothing session-dirty refreshes the live file instead of reverting it", async () => {
    // Boot snapshot values are stale the moment another instance writes. A
    // no-dirty save must merge over the live file, not write them back whole.
    let disk: KitsuneConfig = { ...DEFAULT_CONFIG };
    const store = {
      load: async () => ({ ...disk }),
      save: (doc: KitsuneConfig) => {
        disk = { ...doc };
        return Promise.resolve();
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);

    disk.youtubeProvider = "written-by-other-instance";
    const pending = service.save();
    await service.flushPending();
    await pending;

    expect(disk.youtubeProvider).toBe("written-by-other-instance");
  });

  test("the persist cycle runs inside store.withLock when the store provides one", async () => {
    // persistChain serializes this instance only — cross-process exclusion is
    // the store's job. Two service objects on one real store is the
    // cross-instance shape; the lock must wrap the whole read→merge→write.
    let lockCycles = 0;
    let held = false;
    let wroteUnderLock = false;
    let onDisk: KitsuneConfig = { ...DEFAULT_CONFIG };
    const store = {
      load: async () => ({ ...onDisk }),
      save: (doc: KitsuneConfig) => {
        onDisk = { ...doc };
        wroteUnderLock = held;
        return Promise.resolve();
      },
      reset: async () => {},
      async withLock<T>(fn: () => Promise<T>): Promise<T> {
        lockCycles += 1;
        held = true;
        try {
          return await fn();
        } finally {
          held = false;
        }
      },
    };
    const service = await ConfigServiceImpl.load(store);

    await service.update({ provider: "vidking" });
    const pending = service.save();
    await service.flushPending();
    await pending;

    expect(lockCycles).toBe(1);
    expect(wroteUnderLock).toBe(true);
    expect(onDisk.provider).toBe("vidking");
  });

  test("an unrelated dirty key does not read the on-disk token scrub as an intentional clear", async () => {
    // The vaulted token lives in-memory; config.json carries "". When a
    // different key is dirty, the merged document's empty token is not an
    // update — vault ops must follow the in-memory value.
    const vaultStore = new Map<string, string>([
      [CREDENTIAL_KEYS.videasySessionToken, "tok-persisted"],
    ]);
    const vault: CredentialVaultPort = {
      backend: "secret-service",
      get: async (key) => vaultStore.get(key),
      set: async (key, value) => {
        vaultStore.set(key, value);
      },
      delete: async (key) => {
        vaultStore.delete(key);
      },
    };
    let disk: Partial<KitsuneConfig> = { videasySessionToken: "" };
    const store = {
      load: async () => ({ ...disk }),
      save: (doc: KitsuneConfig) => {
        disk = { ...doc };
        return Promise.resolve();
      },
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store, vault);

    await service.update({ provider: "vidking" });
    const pending = service.save();
    await service.flushPending();
    await pending;

    expect(vaultStore.get(CREDENTIAL_KEYS.videasySessionToken)).toBe("tok-persisted");
    expect(disk.videasySessionToken).toBe("");
  });

  test("sibling instances sharing a store cannot revert each other's keys", async () => {
    // Two services on one backing document stand in for two `kunai` processes
    // writing config.json. The store's withLock serializes each
    // read→merge→write cycle — without it, the second save can merge over a
    // snapshot predating the first write and revert its key.
    let onDisk: KitsuneConfig = { ...DEFAULT_CONFIG };
    let chain: Promise<unknown> = Promise.resolve();
    const store = {
      load: async () => ({ ...onDisk }),
      save: (doc: KitsuneConfig) => {
        onDisk = { ...doc };
        return Promise.resolve();
      },
      reset: async () => {},
      withLock: <T>(fn: () => Promise<T>): Promise<T> => {
        const run = chain.then(fn);
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };
    const first = await ConfigServiceImpl.load(store);
    const second = await ConfigServiceImpl.load(store);

    await first.update({ provider: "allanime" });
    await second.update({ downloadsEnabled: true });
    const firstSave = first.save();
    const secondSave = second.save();
    await first.flushPending();
    await second.flushPending();
    await Promise.all([firstSave, secondSave]);

    expect(onDisk.provider).toBe("allanime");
    expect(onDisk.downloadsEnabled).toBe(true);
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
