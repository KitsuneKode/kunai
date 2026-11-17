import { describe, expect, test } from "bun:test";

import { notificationKindGlyph, notificationKindLabel } from "@/app-shell/notification-kinds";
import { NOTIFICATION_KINDS } from "@/domain/notifications/notification-kinds";
import {
  mapRecordToSinkDelivery,
  NotificationSinkRegistry,
} from "@/services/notifications/notification-sink";
import {
  LogNotificationSink,
  OsNotificationSink,
} from "@/services/notifications/notification-sinks";
import {
  deriveNotifications,
  type NotificationSignal,
} from "@/services/notifications/NotificationEngine";
import type { NotificationRecord } from "@kunai/storage";

describe("notification sinks", () => {
  test("registry fans out deliver and dismiss to registered sinks", () => {
    const registry = new NotificationSinkRegistry();
    const delivered: string[] = [];
    const dismissed: string[] = [];
    registry.register({
      id: "test",
      deliver: (notification) => {
        delivered.push(notification.dedupKey);
      },
      dismiss: (dedupKey) => {
        dismissed.push(dedupKey);
      },
    });

    registry.deliver({
      dedupKey: "dl:1",
      kind: "download-complete",
      title: "Ready",
      createdAt: new Date().toISOString(),
    });
    registry.dismiss("dl:1");

    expect(delivered).toEqual(["dl:1"]);
    expect(dismissed).toEqual(["dl:1"]);
  });

  test("mapRecordToSinkDelivery normalizes optional body", () => {
    expect(
      mapRecordToSinkDelivery({
        dedupKey: "n:1",
        kind: "new-episode",
        title: "New ep",
        body: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        readAt: null,
      } as never),
    ).toEqual({
      dedupKey: "n:1",
      kind: "new-episode",
      title: "New ep",
      body: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("log sink writes structured delivery events", () => {
    const lines: Array<Record<string, unknown>> = [];
    const sink = new LogNotificationSink((message, context) => {
      lines.push({ message, ...context });
    });
    sink.deliver({
      dedupKey: "dl:2",
      kind: "download-failed",
      title: "Failed",
      createdAt: new Date().toISOString(),
    });
    sink.dismiss("dl:2");
    expect(lines[0]?.message).toBe("notification.delivered");
    expect(lines[1]?.message).toBe("notification.dismissed");
  });

  test("os sink is a no-op stub", () => {
    const sink = new OsNotificationSink();
    expect(() =>
      sink.deliver({
        dedupKey: "x",
        kind: "app-update",
        title: "Update",
        createdAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  test("mapRecordToSinkDelivery rejects unknown persisted kinds without casting", () => {
    const record: NotificationRecord = {
      id: "future-1",
      dedupKey: "future:1",
      kind: "future-kind",
      title: "Future notice",
      body: "Written by a newer build",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(mapRecordToSinkDelivery(record)).toBeNull();
  });

  test("every kind NotificationEngine can emit is handled by each sink", () => {
    const allSignals: readonly NotificationSignal[] = [
      {
        type: "new-playable-episode",
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 1,
        providerId: "vidlink",
        availableAt: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "queue-recoverable",
        queueSessionId: "q:1",
        itemCount: 2,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "download-complete",
        titleId: "tmdb:2",
        mediaKind: "movie",
        title: "Movie",
      },
      {
        type: "download-failed",
        titleId: "tmdb:3",
        mediaKind: "movie",
        title: "Movie 2",
        error: "network error",
      },
      {
        type: "app-update",
        currentVersion: "0.3.0",
        latestVersion: "0.4.0",
        pendingRestart: false,
      },
      {
        type: "app-update",
        currentVersion: "0.3.0",
        latestVersion: "0.4.0",
        pendingRestart: true,
      },
      {
        type: "provider-health",
        providerId: "allanime",
        suggestedProviderId: "miruro",
      },
    ];

    const derived = deriveNotifications({
      signals: allSignals,
      mutedTitleIds: new Set(),
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(new Set(derived.map((item) => item.kind))).toEqual(new Set(NOTIFICATION_KINDS));

    const logged: Array<{
      readonly message: string;
      readonly dedupKey?: unknown;
      readonly kind?: unknown;
      readonly title?: unknown;
    }> = [];
    const logSink = new LogNotificationSink((message, context) => {
      logged.push({ message, ...context });
    });
    const osSink = new OsNotificationSink();
    const registry = new NotificationSinkRegistry();
    registry.register(logSink);
    registry.register(osSink);

    for (const notice of derived) {
      const record: NotificationRecord = {
        id: notice.dedupKey,
        dedupKey: notice.dedupKey,
        kind: notice.kind,
        title: notice.title,
        body: notice.body,
        createdAt: notice.createdAt,
        updatedAt: notice.updatedAt,
      };
      const delivery = mapRecordToSinkDelivery(record);
      expect(delivery).not.toBeNull();
      expect(() => registry.deliver(delivery!)).not.toThrow();
      expect(notificationKindGlyph(notice.kind)).not.toBe("◇");
      expect(notificationKindLabel(notice.kind)).not.toBe("Notification");
    }

    expect(logged).toHaveLength(NOTIFICATION_KINDS.length);
    expect(logged.map((entry) => entry.kind)).toEqual(derived.map((item) => item.kind));
  });
});
