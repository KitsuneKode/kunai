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
    for (let index = 0; index < 550; index += 1) {
      store.record({ category: "ui", message: `event-${index}` });
    }

    const events = store.getRecent(550);
    expect(events).toHaveLength(500);
    expect(events.at(-1)?.message).toBe("event-50");
  });

  test("redacts and bounds events before storing them", () => {
    const store = new DiagnosticsStoreImpl();
    store.record({
      category: "provider",
      message: "a".repeat(700),
      context: {
        streamUrl: "https://cdn.example/stream.m3u8?token=secret",
        detail: "b".repeat(1_200),
      },
    });

    const event = store.getSnapshot()[0];
    expect(event?.message).toBe(`${"a".repeat(497)}...`);
    expect(event?.context).toMatchObject({
      streamUrl: "https://cdn.example/stream.m3u8?token=[redacted]",
      detail: `${"b".repeat(997)}...`,
      status: "succeeded",
      severity: "healthy",
      recommendedAction: "none",
      spanFamily: "provider.resolve",
    });
  });
});
