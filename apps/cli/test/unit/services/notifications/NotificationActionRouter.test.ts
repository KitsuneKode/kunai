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

test("restore-queue restores the persisted queue session and dismisses the notice", async () => {
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

  await router.run({
    actionId: "restore-queue",
    notification: notification({
      itemJson: JSON.stringify({ queueSessionId: "old-session" }),
    }),
  });

  expect(calls).toEqual(["restore:old-session", "dismiss:queue-recoverable:old-session"]);
});

test("episode notification actions delegate to media action routing", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    mediaActions: {
      run: async (input) => {
        calls.push(`${input.actionId}:${input.item.title}:${input.source}`);
      },
    },
    notifications: {
      dismiss: () => {
        calls.push("dismiss");
      },
    },
  });

  await router.run({
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

  expect(calls).toEqual(["queue-next:Frieren:notification"]);
});

test("parseAppUpdateVersion reads the target version from the dedupKey", () => {
  expect(parseAppUpdateVersion(notification({ dedupKey: "app-update:1.4.0" }))).toBe("1.4.0");
  expect(parseAppUpdateVersion(notification({ dedupKey: "app-update:" }))).toBeNull();
  expect(parseAppUpdateVersion(notification({ dedupKey: "queue-recoverable:x" }))).toBeNull();
});

test("update-app opens the release page for the advertised version and clears the notice", async () => {
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

  await router.run({
    actionId: "update-app",
    notification: notification({
      kind: "app-update",
      dedupKey: "app-update:1.4.0",
      title: "Update available · 1.4.0",
    }),
  });

  expect(calls).toEqual(["open:1.4.0", "dismiss:app-update:1.4.0"]);
});

test("update-app stays a no-op when no appUpdate handler is wired", async () => {
  const calls: string[] = [];
  const router = new NotificationActionRouter({
    notifications: {
      dismiss: (dedupKey) => {
        calls.push(`dismiss:${dedupKey}`);
      },
    },
  });

  await router.run({
    actionId: "update-app",
    notification: notification({ kind: "app-update", dedupKey: "app-update:1.4.0" }),
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
