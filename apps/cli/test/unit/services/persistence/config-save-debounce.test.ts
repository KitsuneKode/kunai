import { describe, expect, test } from "bun:test";

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
    // Well below the 300ms debounce window.
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  test("flushPending with nothing pending is a no-op", async () => {
    const store = createCountingStore();
    const service = await ConfigServiceImpl.load(store);

    await service.flushPending();

    expect(store.saves).toBe(0);
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
    rejectSave(new Error("disk full"));

    expect((await saved)?.message).toBe("disk full");
    expect((await flushed)?.message).toBe("disk full");
  });
});
