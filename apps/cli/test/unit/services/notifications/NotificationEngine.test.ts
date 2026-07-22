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

test("derives a download-complete notification", () => {
  const [n] = deriveNotifications({
    signals: [
      {
        type: "download-complete",
        titleId: "t1",
        mediaKind: "series",
        title: "Show",
        season: 1,
        episode: 5,
      },
    ],
    mutedTitleIds: new Set(),
    now: "2026-06-14T01:00:00.000Z",
  });
  expect(n?.kind).toBe("download-complete");
  expect(n?.dedupKey).toBe("download-complete:t1:1:5");
});

test("derives a download-failed notification", () => {
  const [n] = deriveNotifications({
    signals: [
      {
        type: "download-failed",
        titleId: "t1",
        mediaKind: "series",
        title: "Show",
        season: 1,
        episode: 5,
        error: "network",
      },
    ],
    mutedTitleIds: new Set(),
    now: "2026-06-14T01:00:00.000Z",
  });
  expect(n?.kind).toBe("download-failed");
  expect(n?.dedupKey).toContain("download-failed:t1");
});

test("derives an app-update notification", () => {
  const [n] = deriveNotifications({
    signals: [{ type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0" }],
    mutedTitleIds: new Set(),
    now: "2026-06-14T01:00:00.000Z",
  });
  expect(n?.kind).toBe("app-update");
  expect(n?.dedupKey).toBe("app-update:1.3.0");
  expect(n?.title).toContain("1.3.0");
});

// An auto-applied update is already on disk. Announcing it as "Update
// available · Update to 1.3.0" told the user to install a version they had, and
// offered an update action with nothing left to do.
test("a pending-restart update is announced as restart-required, not as available", () => {
  const [n] = deriveNotifications({
    signals: [
      { type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0", pendingRestart: true },
    ],
    mutedTitleIds: new Set(),
    now: "2026-07-22T01:00:00.000Z",
  });
  expect(n?.kind).toBe("app-restart-required");
  expect(n?.dedupKey).toBe("app-restart-required:1.3.0");
  expect(n?.title).toContain("Restart");
  expect(n?.body).toContain("1.3.0");
});

test("restart-required and available notices for one version never collide", () => {
  const notifications = deriveNotifications({
    signals: [
      { type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0" },
      { type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0", pendingRestart: true },
    ],
    mutedTitleIds: new Set(),
    now: "2026-07-22T01:00:00.000Z",
  });
  expect(new Set(notifications.map((n) => n.dedupKey)).size).toBe(2);
});

test("newEpisodeProjection=false suppresses new-episode notifications but keeps others", () => {
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
      { type: "app-update", currentVersion: "1.2.0", latestVersion: "1.3.0" },
    ],
    mutedTitleIds: new Set(),
    now: "2026-05-17T00:01:00.000Z",
    flags: { newEpisodeProjection: false },
  });

  expect(notifications.map((n) => n.kind)).toEqual(["app-update"]);
});

test("queueRecovery=false suppresses queue-recovery notifications", () => {
  const notifications = deriveNotifications({
    signals: [{ type: "queue-recoverable", queueSessionId: "s1", itemCount: 2, updatedAt: "t" }],
    mutedTitleIds: new Set(),
    now: "2026-05-17T00:01:00.000Z",
    flags: { queueRecovery: false },
  });

  expect(notifications).toEqual([]);
});

test("flags default to enabled when omitted", () => {
  const notifications = deriveNotifications({
    signals: [{ type: "queue-recoverable", queueSessionId: "s1", itemCount: 2, updatedAt: "t" }],
    mutedTitleIds: new Set(),
    now: "2026-05-17T00:01:00.000Z",
    flags: {},
  });

  expect(notifications).toHaveLength(1);
});
