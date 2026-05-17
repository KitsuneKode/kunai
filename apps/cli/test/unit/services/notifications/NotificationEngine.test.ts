import { expect, test } from "bun:test";

import { deriveNotifications } from "@/services/notifications/NotificationEngine";

test("new playable episode creates one dedupable notification without stream URLs", () => {
  const notifications = deriveNotifications({
    signals: [
      {
        type: "new-playable-episode",
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 6,
        providerId: "vidking",
        availableAt: "2026-05-17T00:00:00.000Z",
        streamUrl: "https://must-not-leak.example/master.m3u8",
      },
    ],
    mutedTitleIds: new Set(),
    now: "2026-05-17T00:01:00.000Z",
  });

  expect(notifications).toHaveLength(1);
  expect(notifications[0]?.dedupKey).toBe("new-playable-episode:tmdb:1:1:6:vidking");
  expect(JSON.stringify(notifications[0])).not.toContain("http");
});

test("muted titles suppress new episode notifications", () => {
  const notifications = deriveNotifications({
    signals: [
      {
        type: "new-playable-episode",
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 6,
        providerId: "vidking",
        availableAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    mutedTitleIds: new Set(["tmdb:1"]),
    now: "2026-05-17T00:01:00.000Z",
  });

  expect(notifications).toEqual([]);
});

test("recoverable queue creates a deliberate restore notification", () => {
  const notifications = deriveNotifications({
    signals: [
      {
        type: "queue-recoverable",
        queueSessionId: "queue-session-1",
        itemCount: 3,
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    mutedTitleIds: new Set(),
    now: "2026-05-17T00:01:00.000Z",
  });

  expect(notifications[0]?.kind).toBe("queue-recovery");
  expect(notifications[0]?.dedupKey).toBe("queue-recoverable:queue-session-1");
});
