import { describe, expect, test } from "bun:test";

import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";

describe("DiagnosticsStoreImpl", () => {
  test("returns recent events in reverse chronological order", () => {
    const store = new DiagnosticsStoreImpl();
    store.record({ category: "search", message: "First" });
    store.record({ category: "playback", message: "Second" });

    const events = store.getRecent();
    expect(events[0]?.message).toBe("Second");
    expect(events[1]?.message).toBe("First");
  });

  test("getSnapshot returns chronological order", () => {
    const store = new DiagnosticsStoreImpl();
    store.record({ category: "search", message: "First" });
    store.record({ category: "playback", message: "Second" });
    const snap = store.getSnapshot();
    expect(snap.map((e) => e.message)).toEqual(["First", "Second"]);
  });

  test("caps the internal buffer", () => {
    const store = new DiagnosticsStoreImpl();
    for (let index = 0; index < 250; index += 1) {
      store.record({ category: "ui", message: `event-${index}` });
    }

    const events = store.getRecent(250);
    expect(events).toHaveLength(200);
    expect(events.at(-1)?.message).toBe("event-50");
  });
});
