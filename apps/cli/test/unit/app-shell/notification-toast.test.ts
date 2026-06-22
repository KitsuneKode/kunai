import { describe, expect, test } from "bun:test";

import { formatNotificationToast } from "@/app-shell/notification-queue";
import { selectNotificationToast } from "@/app-shell/notification-toast";

const item = (dedupKey: string, kind: string, title: string) => ({ dedupKey, kind, title });

describe("selectNotificationToast", () => {
  test("a new active key produces a toast with kind glyph + label + title", () => {
    const r = selectNotificationToast({
      active: [item("k1", "new-episode", "Bungo Stray Dogs")],
      seenKeys: new Set<string>(),
    });
    expect(r.toast).toBe("● New episode — Bungo Stray Dogs");
    expect(r.seenKeys.has("k1")).toBe(true);
  });

  test("no new keys → null toast", () => {
    const r = selectNotificationToast({
      active: [item("k1", "new-episode", "Show")],
      seenKeys: new Set(["k1"]),
    });
    expect(r.toast).toBeNull();
  });

  test("seeded-on-mount (all seen) never toasts", () => {
    const active = [item("k1", "new-episode", "A"), item("k2", "download-complete", "B")];
    const seenKeys = new Set(active.map((a) => a.dedupKey));
    expect(selectNotificationToast({ active, seenKeys }).toast).toBeNull();
  });

  test("multiple new → newest (first of DESC-ordered active) wins", () => {
    const r = selectNotificationToast({
      active: [item("new2", "download-failed", "Newest"), item("new1", "new-episode", "Older")],
      seenKeys: new Set<string>(),
    });
    expect(r.toast).toBe("⚠ Download failed — Newest");
  });

  test("a removed key drops out of the returned seenKeys", () => {
    const r = selectNotificationToast({
      active: [item("k2", "new-episode", "B")],
      seenKeys: new Set(["k1", "k2"]),
    });
    expect(r.seenKeys.has("k1")).toBe(false);
    expect(r.seenKeys.has("k2")).toBe(true);
  });

  test("unknown kind falls back to a neutral glyph + label", () => {
    const r = selectNotificationToast({
      active: [item("k1", "mystery", "Thing")],
      seenKeys: new Set<string>(),
    });
    expect(r.toast).toBe(formatNotificationToast({ kind: "mystery", title: "Thing" }));
  });
});
