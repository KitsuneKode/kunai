import { describe, expect, test } from "bun:test";

import {
  createNotificationQueueState,
  enqueueNotificationItems,
  formatNotificationToast,
  NOTIFICATION_TOAST_TTL_MS,
  syncNotificationQueueFromActive,
  tickNotificationQueue,
} from "@/app-shell/notification-queue";

const item = (dedupKey: string, kind: string, title: string) => ({ dedupKey, kind, title });

describe("notification-queue", () => {
  test("folds duplicate dedupKey updates in the queue", () => {
    let state = createNotificationQueueState();
    state = enqueueNotificationItems(state, [item("k1", "download-complete", "Show A")], 1_000);
    state = enqueueNotificationItems(
      state,
      [item("k1", "download-complete", "Show A (retry)")],
      1_100,
    );
    expect(state.queue).toHaveLength(0);
    expect(state.current?.title).toBe("Show A (retry)");
  });

  test("priority orders queued items after the current toast expires", () => {
    let state = enqueueNotificationItems(
      createNotificationQueueState(),
      [
        { ...item("low", "app-update", "Update"), priority: "low" },
        { ...item("high", "download-failed", "Failed"), priority: "high" },
      ],
      1_000,
    );
    expect(state.current?.dedupKey).toBe("high");

    const advanced = tickNotificationQueue(state, 1_000 + NOTIFICATION_TOAST_TTL_MS);
    expect(advanced.toast).toBe(formatNotificationToast({ kind: "app-update", title: "Update" }));
    expect(advanced.state.current?.dedupKey).toBe("low");
  });

  test("invalidates superseded keys when a download completes", () => {
    let state = enqueueNotificationItems(
      createNotificationQueueState(),
      [item("fail", "download-failed", "Show A")],
      1_000,
    );
    state = enqueueNotificationItems(
      state,
      [
        {
          ...item("done", "download-complete", "Show A"),
          invalidates: ["fail"],
        },
      ],
      1_050,
    );
    expect(state.queue.some((queued) => queued.dedupKey === "fail")).toBe(false);
    expect(state.current?.dedupKey).toBe("done");
  });

  test("sync sequences multiple unseen arrivals instead of overwriting", () => {
    const seeded = syncNotificationQueueFromActive({
      state: createNotificationQueueState(),
      active: [item("a", "download-complete", "A"), item("b", "queue-recovery", "B")],
      seenKeys: new Set<string>(),
      now: 2_000,
    });
    expect(seeded.toast).toContain("Queue recovered");
    expect(seeded.state.queue).toHaveLength(1);
    expect(seeded.state.queue[0]?.dedupKey).toBe("a");

    const advanced = tickNotificationQueue(seeded.state, 2_000 + NOTIFICATION_TOAST_TTL_MS);
    expect(advanced.toast).toContain("Download complete");
  });

  test("seeded-on-mount arrivals do not toast", () => {
    const active = [item("k1", "new-episode", "A"), item("k2", "download-complete", "B")];
    const seenKeys = new Set(active.map((entry) => entry.dedupKey));
    const synced = syncNotificationQueueFromActive({
      state: createNotificationQueueState(),
      active,
      seenKeys,
      now: 1_000,
    });
    expect(synced.toast).toBeNull();
  });
});
