import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { createRoamerVisibilityStore, KunaiFoxRoamer } from "../components/brand/kunai-fox-roamer";

function fixture({ dismissed = false, storageDenied = false } = {}) {
  const events = new EventTarget();
  const fine = Object.assign(new EventTarget(), { matches: true });
  const reduced = Object.assign(new EventTarget(), { matches: false });
  let stored = dismissed ? "1" : null;
  const host = {
    matchMedia: (query: string) => (query.includes("pointer") ? fine : reduced),
    localStorage: {
      getItem: () => {
        if (storageDenied) throw new Error("storage denied");
        return stored;
      },
      removeItem: () => {
        if (storageDenied) throw new Error("storage denied");
        stored = null;
      },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  return { store: createRoamerVisibilityStore(host), events, fine, reduced };
}

describe("roamer browser visibility", () => {
  test("server markup remains empty", () => {
    expect(renderToStaticMarkup(<KunaiFoxRoamer />)).toBe("");
  });

  test("persisted dismissal is honoured before paint and restore clears it", () => {
    const { store, events } = fixture({ dismissed: true });
    const release = store.subscribe(() => {});
    expect(store.getSnapshot()).toBe(false);
    events.dispatchEvent(new Event("kunai:roamer-restore"));
    expect(store.getSnapshot()).toBe(true);
    release();
  });

  test("dismiss and restore survive denied storage for this page view", () => {
    const { store, events } = fixture({ storageDenied: true });
    const release = store.subscribe(() => {});
    expect(store.getSnapshot()).toBe(true);
    events.dispatchEvent(new Event("kunai:roamer-dismissed"));
    expect(store.getSnapshot()).toBe(false);
    events.dispatchEvent(new Event("kunai:roamer-restore"));
    expect(store.getSnapshot()).toBe(true);
    release();
  });

  test("media preference changes notify readers and cleanup removes listeners", () => {
    const { store, fine, reduced } = fixture();
    let notifications = 0;
    const release = store.subscribe(() => notifications++);
    reduced.matches = true;
    reduced.dispatchEvent(new Event("change"));
    expect(store.getSnapshot()).toBe(false);
    reduced.matches = false;
    fine.matches = false;
    fine.dispatchEvent(new Event("change"));
    expect(store.getSnapshot()).toBe(false);
    expect(notifications).toBe(2);
    release();
    fine.dispatchEvent(new Event("change"));
    expect(notifications).toBe(2);
  });

  test("ineligible restore preserves a stored dismissal", () => {
    const { store, events, fine } = fixture({ dismissed: true });
    const release = store.subscribe(() => {});
    fine.matches = false;
    events.dispatchEvent(new Event("kunai:roamer-restore"));
    fine.matches = true;
    expect(store.getSnapshot()).toBe(false);
    release();
  });
});
