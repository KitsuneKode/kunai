import { expect, test } from "bun:test";

import {
  NotificationActionRouter,
  parseAppUpdateVersion,
} from "@/services/notifications/NotificationActionRouter";
import type { NotificationRecord } from "@kunai/storage";

function notification(overrides: Partial<NotificationRecord>): NotificationRecord {
  return {
    id: "notice-1",
    dedupKey: "queue-recoverable:old-session",
    kind: "queue-recovery",
    title: "Previous queue available",
    body: "2 queued items can be restored",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
    ...overrides,
  };
}

test("restore-queue restores the persisted queue session without dismissing the notice", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    playlist: {
      restoreRecoverableSession: (sessionId) => {
        calls.push(`restore:${sessionId}`);
        return 2;
      },
    },
    notifications: {
      dismiss: (dedupKey) => {
        calls.push(`dismiss:${dedupKey}`);
      },
    },
  });

  const result = await router.run({
    actionId: "restore-queue",
    notification: notification({
      itemJson: JSON.stringify({ queueSessionId: "old-session" }),
    }),
  });

  expect(result).toEqual({ status: "handled", actionId: "restore-queue" });
  expect(calls).toEqual(["restore:old-session"]);
});

test("restore-queue without a playlist executor reports unsupported", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    notifications: {
      dismiss: (dedupKey) => {
        calls.push(`dismiss:${dedupKey}`);
      },
    },
  });

  const result = await router.run({
    actionId: "restore-queue",
    notification: notification({
      itemJson: JSON.stringify({ queueSessionId: "old-session" }),
    }),
  });

  expect(result).toEqual({
    status: "unsupported",
    actionId: "restore-queue",
    reason: "No executor registered for restore-queue",
  });
  expect(calls).toEqual([]);
});

test("stored dismiss is the only action that dismisses through the lifecycle callback", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    notifications: {
      dismiss: (dedupKey) => {
        calls.push(`dismiss:${dedupKey}`);
      },
    },
  });

  const result = await router.run({
    actionId: "dismiss",
    notification: notification({}),
  });

  expect(result).toEqual({ status: "handled", actionId: "dismiss" });
  expect(calls).toEqual(["dismiss:queue-recoverable:old-session"]);
});

test("episode notification actions delegate to media action routing", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    mediaActions: {
      run: async (input) => {
        calls.push(`${input.actionId}:${input.item.title}:${input.source}`);
        return { status: "handled", actionId: input.actionId };
      },
    },
    notifications: {
      dismiss: () => {
        calls.push("dismiss");
      },
    },
  });

  const result = await router.run({
    actionId: "queue-next",
    notification: notification({
      kind: "new-episode",
      dedupKey: "new-playable-episode:tmdb:1:1:6:vidking",
      itemJson: JSON.stringify({
        mediaKind: "anime",
        titleId: "tmdb:1",
        title: "Frieren",
        season: 1,
        episode: 6,
      }),
    }),
    playbackActive: true,
  });

  expect(result).toEqual({ status: "handled", actionId: "queue-next" });
  expect(calls).toEqual(["queue-next:Frieren:notification"]);
});

test("media actions without a media executor report unsupported", async () => {
  const router = new NotificationActionRouter({
    notifications: { dismiss: () => {} },
  });

  const result = await router.run({
    actionId: "queue-next",
    notification: notification({
      kind: "new-episode",
      itemJson: JSON.stringify({ mediaKind: "anime", titleId: "tmdb:1", title: "Frieren" }),
    }),
  });

  expect(result).toEqual({
    status: "unsupported",
    actionId: "queue-next",
    reason: "No executor registered for queue-next",
  });
});

test("media unsupported outcomes propagate with the original notification action id", async () => {
  const router = new NotificationActionRouter({
    mediaActions: {
      run: async (input) => ({
        status: "unsupported",
        actionId: input.actionId,
        reason: "Downloads are not available yet",
      }),
    },
    notifications: { dismiss: () => {} },
  });

  const result = await router.run({
    actionId: "retry-download",
    notification: notification({
      kind: "download-failed",
      itemJson: JSON.stringify({ mediaKind: "anime", titleId: "tmdb:1", title: "Frieren" }),
    }),
  });

  expect(result).toEqual({
    status: "unsupported",
    actionId: "retry-download",
    reason: "Downloads are not available yet",
  });
});

test("retry-download maps to the standard download media action", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    mediaActions: {
      run: async (input) => {
        calls.push(input.actionId);
        return { status: "handled", actionId: input.actionId };
      },
    },
    notifications: { dismiss: () => {} },
  });

  const result = await router.run({
    actionId: "retry-download",
    notification: notification({
      kind: "download-failed",
      itemJson: JSON.stringify({ mediaKind: "anime", titleId: "tmdb:1", title: "Frieren" }),
    }),
  });

  expect(result).toEqual({ status: "handled", actionId: "retry-download" });
  expect(calls).toEqual(["download"]);
});

test("thrown media executor errors propagate to the caller", async () => {
  const router = new NotificationActionRouter({
    mediaActions: {
      run: async () => {
        throw new Error("provider blew up");
      },
    },
    notifications: { dismiss: () => {} },
  });

  await expect(
    router.run({
      actionId: "queue-next",
      notification: notification({
        kind: "new-episode",
        itemJson: JSON.stringify({ mediaKind: "anime", titleId: "tmdb:1", title: "Frieren" }),
      }),
    }),
  ).rejects.toThrow("provider blew up");
});

test("parseAppUpdateVersion reads the target version from the dedupKey", () => {
  expect(parseAppUpdateVersion(notification({ dedupKey: "app-update:1.4.0" }))).toBe("1.4.0");
  expect(parseAppUpdateVersion(notification({ dedupKey: "app-update:" }))).toBeNull();
  expect(parseAppUpdateVersion(notification({ dedupKey: "queue-recoverable:x" }))).toBeNull();
});

test("update-app opens the release page without dismissing the notice", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    appUpdate: {
      openReleasePage: (latestVersion) => {
        calls.push(`open:${latestVersion}`);
      },
    },
    notifications: {
      dismiss: (dedupKey) => {
        calls.push(`dismiss:${dedupKey}`);
      },
    },
  });

  const result = await router.run({
    actionId: "update-app",
    notification: notification({
      kind: "app-update",
      dedupKey: "app-update:1.4.0",
      title: "Update available · 1.4.0",
    }),
  });

  expect(result).toEqual({ status: "handled", actionId: "update-app" });
  expect(calls).toEqual(["open:1.4.0"]);
});

test("update-app without an appUpdate handler reports unsupported", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    notifications: {
      dismiss: (dedupKey) => {
        calls.push(`dismiss:${dedupKey}`);
      },
    },
  });

  const result = await router.run({
    actionId: "update-app",
    notification: notification({ kind: "app-update", dedupKey: "app-update:1.4.0" }),
  });

  expect(result).toEqual({
    status: "unsupported",
    actionId: "update-app",
    reason: "No executor registered for update-app",
  });
  expect(calls).toEqual([]);
});

test("media notification actions fail fast when no media payload exists", async () => {
  const router = new NotificationActionRouter({
    notifications: { dismiss: () => {} },
  });

  await expect(
    router.run({
      actionId: "queue-next",
      notification: notification({ itemJson: undefined }),
    }),
  ).rejects.toThrow("media item");
});
