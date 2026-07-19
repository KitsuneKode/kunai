import { describe, expect, test } from "bun:test";

import { executeNotificationOverlayAction } from "@/app-shell/notification-action-flow";
import type {
  NotificationActionId,
  NotificationActionRunResult,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@kunai/storage";

const notice: NotificationRecord = {
  id: "notice-1",
  dedupKey: "notice-1",
  kind: "new-episode",
  title: "Frieren S1E13 available",
  body: "available on allanime",
  actionJson: JSON.stringify(["queue-next", "dismiss"]),
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

function makeDeps(result: NotificationActionRunResult | Error) {
  const calls: string[] = [];
  const router = {
    run: async (input: {
      actionId: NotificationActionId;
    }): Promise<NotificationActionRunResult> => {
      calls.push("router:start");
      if (result instanceof Error) throw result;
      calls.push("router:done");
      void input;
      return result;
    },
  };
  const markRead = (dedupKey: string) => {
    calls.push(`mark-read:${dedupKey}`);
  };
  return { router, markRead, calls };
}

describe("executeNotificationOverlayAction", () => {
  test("handled non-lifecycle action marks the notice read", async () => {
    const { router, markRead, calls } = makeDeps({ status: "handled", actionId: "queue-next" });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "queue-next",
      playbackActive: false,
      markRead,
    });

    expect(result).toEqual({ status: "handled", actionId: "queue-next" });
    expect(calls).toEqual(["router:start", "router:done", "mark-read:notice-1"]);
  });

  test("handled restore-queue marks read and never archives", async () => {
    const { router, markRead, calls } = makeDeps({ status: "handled", actionId: "restore-queue" });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "restore-queue",
      playbackActive: false,
      markRead,
    });

    expect(result).toEqual({ status: "handled", actionId: "restore-queue" });
    expect(calls).toContain("mark-read:notice-1");
  });

  test("handled update-app marks read", async () => {
    const { router, markRead, calls } = makeDeps({ status: "handled", actionId: "update-app" });

    await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "update-app",
      playbackActive: false,
      markRead,
    });

    expect(calls).toContain("mark-read:notice-1");
  });

  test("handled dismiss does not mark read", async () => {
    const { router, markRead, calls } = makeDeps({ status: "handled", actionId: "dismiss" });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "dismiss",
      playbackActive: false,
      markRead,
    });

    expect(result).toEqual({ status: "handled", actionId: "dismiss" });
    expect(calls).toEqual(["router:start", "router:done"]);
  });

  test("unsupported outcomes do not mark read", async () => {
    const { router, markRead, calls } = makeDeps({
      status: "unsupported",
      actionId: "queue-next",
      reason: "No executor registered for queue-next",
    });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "queue-next",
      playbackActive: false,
      markRead,
    });

    expect(result).toEqual({
      status: "unsupported",
      actionId: "queue-next",
      reason: "No executor registered for queue-next",
    });
    expect(calls).toEqual(["router:start", "router:done"]);
  });

  test("thrown router errors propagate without marking read", async () => {
    const { router, markRead, calls } = makeDeps(new Error("boom"));

    await expect(
      executeNotificationOverlayAction({
        router,
        notification: notice,
        actionId: "queue-next",
        playbackActive: false,
        markRead,
      }),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["router:start"]);
  });

  test("mark-read failure preserves the handled action result", async () => {
    const error = new Error("database locked");
    const { router, calls } = makeDeps({ status: "handled", actionId: "queue-next" });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "queue-next",
      playbackActive: false,
      markRead: () => {
        calls.push("mark-read:start");
        throw error;
      },
    });

    expect(result).toEqual({
      status: "handled",
      actionId: "queue-next",
      markReadError: error,
    });
    expect(calls).toEqual(["router:start", "router:done", "mark-read:start"]);
  });

  test("play-now during active playback requires confirmation before touching the router", async () => {
    const { router, markRead, calls } = makeDeps({ status: "handled", actionId: "play-now" });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "play-now",
      playbackActive: true,
      markRead,
    });

    expect(result).toEqual({ status: "confirmation-required", actionId: "play-now" });
    expect(calls).toEqual([]);
  });

  test("confirmed play-now runs the router first, then marks read", async () => {
    const { router, markRead, calls } = makeDeps({ status: "handled", actionId: "play-now" });

    const result = await executeNotificationOverlayAction({
      router,
      notification: notice,
      actionId: "play-now",
      playbackActive: true,
      confirmedContextSwitch: true,
      markRead,
    });

    expect(result).toEqual({ status: "handled", actionId: "play-now" });
    expect(calls).toEqual(["router:start", "router:done", "mark-read:notice-1"]);
  });
});
