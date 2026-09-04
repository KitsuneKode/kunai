import { afterEach, describe, expect, test } from "bun:test";

import {
  browserRoamerStore,
  readRoamerDismissed,
  resolveRoamerUrlOverride,
  ROAMER_DISMISSED_KEY,
  setRoamerDismissed,
  subscribeRoamerPreference,
  urlWithoutRoamerParam,
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
function installWindow(descriptor: PropertyDescriptor): void {
  const target = new EventTarget();
  Object.defineProperty(target, "localStorage", descriptor);
  Object.defineProperty(globalThis, "window", { value: target, configurable: true });
}

/** A window whose `localStorage` is readable and holds `store`. */
function withStorage(store: RoamerStore): void {
  installWindow({ value: store });
}

/**
 * A window whose `localStorage` throws on the property *access*, not the read.
 *
 * That is the real Firefox shape with cookies blocked for the origin, and it is
 * why `browserRoamerStore` cannot be a plain expression at the call site.
 */
function withBlockedStorage(): void {
  installWindow({
    get: () => {
      throw new Error("blocked");
    },
  });
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
    withBlockedStorage();

    const store = browserRoamerStore();
    expect(store).not.toBeNull();
    writeRoamerDismissed(store, true);
    expect(readRoamerDismissed(store)).toBe(true);

    // The fallback is a module-level singleton, so this test has to put it back.
    writeRoamerDismissed(store, false);
  });

  test("uses the real store when there is one", () => {
    const real = fakeStore();
    withStorage(real);

    writeRoamerDismissed(browserRoamerStore(), true);
    expect(real.cells.get(ROAMER_DISMISSED_KEY)).toBe("1");
  });
});

describe("cross-surface notification", () => {
  test("setting the preference tells listeners in this tab", () => {
    withStorage(fakeStore());
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
    withStorage(fakeStore());
    let calls = 0;
    const unsubscribe = subscribeRoamerPreference(() => (calls += 1));
    const emit = (key: string | null) => {
      // SAFETY: Bun has no `StorageEvent` constructor, so the one field the
      // subscriber reads is attached to a plain `Event`. The assertion widens
      // the local type to match what is actually being dispatched; the
      // listener under test only ever touches `.key`.
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

describe("spending the ?kanna= parameter", () => {
  test("takes only our parameter out, keeping the rest of the URL intact", () => {
    expect(urlWithoutRoamerParam("https://x.dev/docs?kanna=on")).toBe("/docs");
    expect(urlWithoutRoamerParam("https://x.dev/docs?a=1&kanna=on&b=2")).toBe("/docs?a=1&b=2");
    expect(urlWithoutRoamerParam("https://x.dev/docs?kanna=off#poses")).toBe("/docs#poses");
    expect(urlWithoutRoamerParam("https://x.dev/?kanna=on")).toBe("/");
  });

  test("is null when there is nothing to spend, so history is left alone", () => {
    expect(urlWithoutRoamerParam("https://x.dev/docs")).toBeNull();
    expect(urlWithoutRoamerParam("https://x.dev/docs?a=1")).toBeNull();
  });

  test("removes the parameter even when its value was not a legible instruction", () => {
    // `?kanna=maybe` changes nothing, but leaving it in the bar would still let
    // it ride into a copied link and look like it meant something.
    expect(resolveRoamerUrlOverride("?kanna=maybe")).toBeNull();
    expect(urlWithoutRoamerParam("https://x.dev/docs?kanna=maybe")).toBe("/docs");
  });
});
