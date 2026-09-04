/**
 * Whether Kanna is welcome on this site.
 *
 * One module owns the flag because three surfaces now read or write it — her
 * dismiss button, the undo that follows it, and the toggle on her docs page —
 * and a preference three places each poke at their own way is a preference that
 * drifts.
 *
 * Everything here is total. A blocked, full, or absent store degrades to "she is
 * welcome" rather than throwing: a browser refusing to persist a mascot
 * preference is not a reason to refuse to draw the mascot. That asymmetry is
 * deliberate — the failure mode of a lost preference is a fox you have to
 * dismiss again, and the failure mode of a thrown exception is a blank page.
 *
 * The storage handle is a parameter rather than a module-level `localStorage`
 * read so the rules here are testable without a DOM, and so a caller on the
 * server can pass `null` and get honest defaults instead of a crash.
 */

/** Where the dismissal lives. Changing this stands people back up who had sat her down. */
export const ROAMER_DISMISSED_KEY = "kunai.roamer.dismissed";

/**
 * Fired on `window` when the flag changes in this tab.
 *
 * The browser's own `storage` event only fires in *other* tabs, so without this
 * the docs-page toggle would flip the flag and the roamer — mounted once in the
 * root layout and never remounted — would not notice until a reload.
 */
export const ROAMER_PREFERENCE_EVENT = "kunai:roamer-preference";

/** `?kanna=on` brings her back, `?kanna=off` sends her away. Both persist. */
export const ROAMER_URL_PARAM = "kanna";

/**
 * The slice of `Storage` this needs.
 *
 * Narrow on purpose: it is the whole contract a test double has to honour, and
 * it makes it obvious at a glance that nothing here enumerates or clears keys
 * that are not ours.
 */
export type RoamerStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What a `?kanna=` link asked for, if it asked for anything legible. */
export type RoamerUrlOverride = "on" | "off";

/**
 * Stands in for `localStorage` when the real one cannot be reached.
 *
 * Firefox with cookies blocked for the origin throws on the property access
 * itself, not on the read. Without a fallback every caller would need its own
 * "the write may not have landed" branch, and the dismiss button would have to
 * keep a second copy of the preference just to make a click hold. The trade is
 * honest and stated once, here: the preference works normally for the page view
 * and is forgotten on reload, which is the most a store that refuses to store
 * anything can offer.
 */
function createMemoryStore(): RoamerStore {
  const cells = new Map<string, string>();
  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => void cells.set(key, value),
    removeItem: (key) => void cells.delete(key),
  };
}

/** Module-level so every caller in a page shares one fallback, not one each. */
const memoryStore = createMemoryStore();

/**
 * Where the preference lives for this caller.
 *
 * `null` means there is no browser at all — a server render, where the honest
 * answer to "has she been dismissed" is "there is nobody here to have dismissed
 * her". A browser that merely refuses to persist still gets a working store.
 */
export function browserRoamerStore(): RoamerStore | null {
  if (!globalThis.window) return null;
  try {
    // Touch it, rather than trusting that it exists: the throw is on access.
    return globalThis.window.localStorage ?? memoryStore;
  } catch {
    return memoryStore;
  }
}

/** True when she has been sent away. Unreadable storage means she has not been. */
export function readRoamerDismissed(store: RoamerStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(ROAMER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Record the preference.
 *
 * Restoring *removes* the key rather than writing `"0"`. The read only ever
 * treats `"1"` as dismissed, so a `"0"` would work — but it would leave a
 * permanent row in every visitor's storage recording that they once clicked an
 * `×`, which is a thing to keep only if something reads it. Nothing does.
 */
export function writeRoamerDismissed(store: RoamerStore | null, dismissed: boolean): void {
  if (!store) return;
  try {
    if (dismissed) store.setItem(ROAMER_DISMISSED_KEY, "1");
    else store.removeItem(ROAMER_DISMISSED_KEY);
  } catch {
    // The preference holds for this page view either way; the caller has
    // already updated its own state and does not depend on the write landing.
  }
}

/**
 * What `?kanna=` in a query string asks for.
 *
 * Strict about the two documented values: anything else is a typo or an
 * unrelated parameter, and quietly reading `?kanna=maybe` as "off" would hide
 * her for reasons no one could work out afterwards.
 */
export function resolveRoamerUrlOverride(search: string): RoamerUrlOverride | null {
  const value = new URLSearchParams(search).get(ROAMER_URL_PARAM)?.trim().toLowerCase();
  if (value === "on") return "on";
  if (value === "off") return "off";
  return null;
}

/**
 * The same URL with our parameter taken out, or `null` if it was not there.
 *
 * Returned rather than applied so this stays testable without a browser, and so
 * the one caller that touches history does it in one obvious place.
 *
 * Worth doing because the parameter is an instruction that has already been
 * carried out. Left in the address bar it rides along into a copied link — and
 * a link that silently retires someone else's fox is a worse version of the bug
 * this whole change is about — and into the page URL that web analytics
 * records, which has no business knowing.
 */
export function urlWithoutRoamerParam(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(ROAMER_URL_PARAM)) return null;
  url.searchParams.delete(ROAMER_URL_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Write the preference and tell every listener in this tab about it. */
export function setRoamerDismissed(dismissed: boolean): void {
  writeRoamerDismissed(browserRoamerStore(), dismissed);
  globalThis.window?.dispatchEvent(
    new CustomEvent(ROAMER_PREFERENCE_EVENT, { detail: { dismissed } }),
  );
}

/**
 * Run `onChange` whenever the preference moves — here or in another tab.
 *
 * Returns the unsubscribe. The `storage` listener is filtered to our key
 * because the callback re-evaluates whether a fox may exist, and doing that on
 * every unrelated write in the origin is work nobody asked for.
 */
export function subscribeRoamerPreference(onChange: () => void): () => void {
  const target = globalThis.window;
  if (!target) return () => {};

  const onStorage = (event: StorageEvent) => {
    // A `null` key is the whole store being cleared, which is also our answer
    // changing.
    if (event.key === null || event.key === ROAMER_DISMISSED_KEY) onChange();
  };

  target.addEventListener(ROAMER_PREFERENCE_EVENT, onChange);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(ROAMER_PREFERENCE_EVENT, onChange);
    target.removeEventListener("storage", onStorage);
  };
}
