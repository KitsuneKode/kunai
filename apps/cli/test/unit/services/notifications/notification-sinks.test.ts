import { describe, expect, test } from "bun:test";

import {
  mapRecordToSinkDelivery,
  NotificationSinkRegistry,
} from "@/services/notifications/notification-sink";
import {
  LogNotificationSink,
  OsNotificationSink,
} from "@/services/notifications/notification-sinks";

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
});
