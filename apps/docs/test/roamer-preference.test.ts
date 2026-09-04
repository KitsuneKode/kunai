import { afterEach, describe, expect, test } from "bun:test";

import {
  browserRoamerStore,
  readRoamerDismissed,
  resolveRoamerUrlOverride,
  ROAMER_DISMISSED_KEY,
  setRoamerDismissed,
  subscribeRoamerPreference,
  writeRoamerDismissed,
  type RoamerStore,
} from "../lib/roamer-preference";

function fakeStore(
  seed: Record<string, string> = {},
): RoamerStore & { cells: Map<string, string> } {
  const cells = new Map(Object.entries(seed));
  return {
    cells,
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => void cells.set(key, value),
    removeItem: (key) => void cells.delete(key),
  };
}

/** A browser that has decided you may not have storage. Firefox does this with cookies blocked. */
const hostileStore: RoamerStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

/** Bun has no `window`; these tests install one only for the cases that need it. */
function installWindow(localStorage: RoamerStore | (() => never)): void {
  const target = new EventTarget();
  if (typeof localStorage === "function") {
    Object.defineProperty(target, "localStorage", { get: localStorage });
  } else {
    Object.defineProperty(target, "localStorage", { value: localStorage });
  }
  Object.defineProperty(globalThis, "window", { value: target, configurable: true });
}

// `window` is process-global, so leaving one installed would leak into every
// other test file in the run — see the module-mocking note in the testing docs.
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("roamer preference flag", () => {
  test("only the literal '1' counts as dismissed", () => {
    expect(readRoamerDismissed(fakeStore({ [ROAMER_DISMISSED_KEY]: "1" }))).toBe(true);
    expect(readRoamerDismissed(fakeStore({ [ROAMER_DISMISSED_KEY]: "0" }))).toBe(false);
    expect(readRoamerDismissed(fakeStore({ [ROAMER_DISMISSED_KEY]: "true" }))).toBe(false);
    expect(readRoamerDismissed(fakeStore())).toBe(false);
  });

  test("no store at all means she has not been dismissed", () => {
    expect(readRoamerDismissed(null)).toBe(false);
  });

  test("restoring removes the key rather than recording a '0'", () => {
    const store = fakeStore({ [ROAMER_DISMISSED_KEY]: "1" });
    writeRoamerDismissed(store, false);
    expect(store.cells.has(ROAMER_DISMISSED_KEY)).toBe(false);
  });

  test("a store that throws on every call degrades to 'she is welcome'", () => {
    expect(readRoamerDismissed(hostileStore)).toBe(false);
    expect(() => writeRoamerDismissed(hostileStore, true)).not.toThrow();
  });
});

describe("?kanna= override", () => {
  test("reads the two documented values, either case, with stray whitespace", () => {
    expect(resolveRoamerUrlOverride("?kanna=on")).toBe("on");
    expect(resolveRoamerUrlOverride("?kanna=off")).toBe("off");
    expect(resolveRoamerUrlOverride("?kanna=OFF")).toBe("off");
    expect(resolveRoamerUrlOverride("?kanna=%20on%20")).toBe("on");
    expect(resolveRoamerUrlOverride("?a=1&kanna=on&b=2")).toBe("on");
  });

  test("anything else is not an instruction to hide her", () => {
    // The failure this guards is silent: reading an unrecognised value as
    // "off" would retire her for a reason nobody could reconstruct later.
    expect(resolveRoamerUrlOverride("?kanna=maybe")).toBeNull();
    expect(resolveRoamerUrlOverride("?kanna=1")).toBeNull();
    expect(resolveRoamerUrlOverride("?kanna=")).toBeNull();
    expect(resolveRoamerUrlOverride("?kannabis=off")).toBeNull();
    expect(resolveRoamerUrlOverride("")).toBeNull();
  });
});

describe("browserRoamerStore", () => {
  test("is null on the server, where nobody has dismissed anything", () => {
    expect("window" in globalThis).toBe(false);
    expect(browserRoamerStore()).toBeNull();
  });

  test("falls back to memory when the browser refuses storage, so a click still holds", () => {
    installWindow(() => {
      throw new Error("blocked");
    });

    const store = browserRoamerStore();
    expect(store).not.toBeNull();
    writeRoamerDismissed(store, true);
    expect(readRoamerDismissed(store)).toBe(true);

    // The fallback is a module-level singleton, so this test has to put it back.
    writeRoamerDismissed(store, false);
  });

  test("uses the real store when there is one", () => {
    const real = fakeStore();
    installWindow(real);

    writeRoamerDismissed(browserRoamerStore(), true);
    expect(real.cells.get(ROAMER_DISMISSED_KEY)).toBe("1");
  });
});

describe("cross-surface notification", () => {
  test("setting the preference tells listeners in this tab", () => {
    installWindow(fakeStore());
    let calls = 0;
    const unsubscribe = subscribeRoamerPreference(() => (calls += 1));

    setRoamerDismissed(true);
    expect(calls).toBe(1);

    // Without this the docs-page toggle would flip the flag and the roamer —
    // mounted once in the root layout — would not notice until a reload.
    setRoamerDismissed(false);
    expect(calls).toBe(2);

    unsubscribe();
    setRoamerDismissed(true);
    expect(calls).toBe(2);
  });

  test("another tab's write counts, and only for our key", () => {
    installWindow(fakeStore());
    let calls = 0;
    const unsubscribe = subscribeRoamerPreference(() => (calls += 1));
    const emit = (key: string | null) => {
      const event = new Event("storage") as Event & { key: string | null };
      event.key = key;
      globalThis.window.dispatchEvent(event);
    };

    emit(ROAMER_DISMISSED_KEY);
    expect(calls).toBe(1);

    emit("some.other.key");
    expect(calls).toBe(1);

    // A null key is the whole store being cleared, which is also our answer.
    emit(null);
    expect(calls).toBe(2);

    unsubscribe();
  });
});
