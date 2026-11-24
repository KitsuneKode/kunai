import { describe, expect, test } from "bun:test";

import type { StoredStremioAddons } from "@/domain/provider/stremio-addons";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";

const A = "https://a.example.com/token/manifest.json";
const B = "https://b.example.com/manifest.json";
const C = "https://c.example.com/manifest.json";

/** `config.json` as it may be on disk: typed, except that the addon list can be hand-edited. */
interface DiskConfig extends Omit<Partial<KitsuneConfig>, "stremioAddons"> {
  stremioAddons?: StoredStremioAddons;
}

interface MemoryDisk {
  disk: DiskConfig;
}

function memoryStore(initial: DiskConfig) {
  const state: MemoryDisk = { disk: { ...DEFAULT_CONFIG, ...initial } };
  return {
    state,
    store: {
      // SAFETY: deliberately not a checked `KitsuneConfig`. A real store hands the
      // service whatever a hand edit left in the file, and that is what these
      // tests feed it.
      load: async () => ({ ...state.disk }) as Partial<KitsuneConfig>,
      save: async (value: KitsuneConfig) => {
        state.disk = { ...value };
      },
      reset: async () => {},
    },
  };
}

async function saved(config: ConfigServiceImpl): Promise<void> {
  const pending = config.save();
  await config.flushPending();
  await pending;
}

/**
 * memoryStore plus the cross-process `withLock` a file backend provides. The
 * `operations` log proves the name record's read→merge→write ran inside one
 * critical section; `saves` counts writes so no-op records can assert zero.
 */
function memoryStoreWithLock(initial: DiskConfig) {
  const base = memoryStore(initial);
  const operations: string[] = [];
  let saves = 0;
  const store = {
    load: async () => {
      operations.push("load");
      return base.store.load();
    },
    save: async (value: KitsuneConfig) => {
      operations.push("save");
      saves += 1;
      return base.store.save(value);
    },
    reset: base.store.reset,
    withLock: async <T>(fn: () => Promise<T>): Promise<T> => {
      operations.push("lock");
      try {
        return await fn();
      } finally {
        operations.push("unlock");
      }
    },
  };
  return {
    state: base.state,
    store,
    operations,
    saves: () => saves,
  };
}

describe("stremioAddons in config", () => {
  test("a config saved before addons existed has none", async () => {
    const { stremioAddons: _absent, ...older } = DEFAULT_CONFIG;
    const { store } = memoryStore({});
    store.load = async () => ({ ...older });

    const config = await ConfigServiceImpl.load(store);

    expect(config.stremioAddons).toEqual([]);
  });

  test("hand-edited entries are re-read through the URL rules on load", async () => {
    const { store } = memoryStore({
      stremioAddons: [
        { url: A, name: "Alpha" },
        { url: "http://plain.example.com/manifest.json" },
        { url: "https://10.0.0.4/manifest.json" },
        "not a url",
        { url: A },
        B,
      ],
    });

    const config = await ConfigServiceImpl.load(store);

    expect(config.stremioAddons).toEqual([{ url: A, name: "Alpha" }, { url: B }]);
  });

  test("a value of the wrong shape cannot break startup", async () => {
    const { store } = memoryStore({ stremioAddons: { url: A } });

    const config = await ConfigServiceImpl.load(store);

    expect(config.stremioAddons).toEqual([]);
  });

  test("an update is normalized and reaches disk", async () => {
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store);

    await config.update({
      stremioAddons: [{ url: ` ${A} ` }, { url: "https://localhost/manifest.json" }],
    });
    await saved(config);

    expect(config.stremioAddons).toEqual([{ url: A }]);
    expect(state.disk.stremioAddons).toEqual([{ url: A }]);
  });

  test("the getter hands out a copy, so a caller cannot edit the stored list", async () => {
    const { store } = memoryStore({ stremioAddons: [{ url: A }] });
    const config = await ConfigServiceImpl.load(store);

    // SAFETY: the cast drops `readonly` on purpose; the test is that editing the
    // returned array cannot reach the stored list.
    (config.stremioAddons as { url: string }[]).pop();

    expect(config.stremioAddons).toEqual([{ url: A }]);
  });
});

describe("recordStremioAddonName", () => {
  test("a concurrent writer's entries and other keys survive the name refresh", async () => {
    const { state, store, operations, saves } = memoryStoreWithLock({
      stremioAddons: [{ url: A, name: "Alpha" }, { url: B }],
      provider: "vidlink",
    });
    const config = await ConfigServiceImpl.load(store);
    operations.length = 0;

    // Another process rewrote the file meanwhile: B is gone, a bare-string C
    // entry arrived (a hand edit the file format tolerates), and an unrelated
    // key moved. The record must merge over that file, not boot's — and the
    // name write touches A's entry only.
    state.disk = {
      ...state.disk,
      stremioAddons: [{ url: A, name: "Alpha" }, C],
      provider: "animepahe",
    };

    await config.recordStremioAddonName(A, "Renamed Alpha");

    expect(state.disk.stremioAddons).toEqual([{ url: A, name: "Renamed Alpha" }, C]);
    expect(state.disk.provider).toBe("animepahe");
    expect(saves()).toBe(1);
    // The read→merge→write ran under one lock acquisition.
    const lockAt = operations.indexOf("lock");
    const unlockAt = operations.lastIndexOf("unlock");
    const critical = operations.slice(lockAt, unlockAt + 1);
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(critical).toContain("load");
    expect(critical).toContain("save");
    expect(critical.indexOf("load")).toBeLessThan(critical.lastIndexOf("save"));
  });

  test("an addon another process removed is not re-added and nothing is written", async () => {
    const { state, store, saves } = memoryStoreWithLock({
      stremioAddons: [{ url: A, name: "Alpha" }, { url: B }],
    });
    const config = await ConfigServiceImpl.load(store);

    state.disk = {
      ...state.disk,
      stremioAddons: [{ url: C, name: "Gamma" }],
    };

    await config.recordStremioAddonName(A, "Renamed Alpha");

    expect(state.disk.stremioAddons).toEqual([{ url: C, name: "Gamma" }]);
    expect(saves()).toBe(0);
  });

  test("recording the name the file already has writes nothing", async () => {
    const { store, saves } = memoryStoreWithLock({
      stremioAddons: [{ url: A, name: "Alpha" }],
    });
    const config = await ConfigServiceImpl.load(store);

    await config.recordStremioAddonName(A, "Alpha");

    expect(saves()).toBe(0);
  });
});
