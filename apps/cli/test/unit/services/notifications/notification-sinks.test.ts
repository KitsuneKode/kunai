import { describe, expect, test } from "bun:test";

import {
  mapRecordToSinkDelivery,
  NotificationSinkRegistry,
} from "@/services/notifications/notification-sink";
import {
  areDesktopNotificationsEnabled,
  LogNotificationSink,
  OsNotificationSink,
  type OsNotificationRuntime,
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

  function fakeRuntime(patch: Partial<OsNotificationRuntime> = {}) {
    const spawned: { command: string[]; env?: Record<string, string> }[] = [];
    const runtime: OsNotificationRuntime = {
      platform: "linux",
      which: (command) => (command === "notify-send" ? `/usr/bin/${command}` : null),
      spawn: (command, options) => {
        spawned.push({
          command,
          // SAFETY: capture seam only — the real spawn options carry a string
          // env map; the cast lets the fake record it without restating the
          // runtime's full option surface.
          env: options?.env as Record<string, string> | undefined,
        });
        return { exited: Promise.resolve(0) };
      },
      ...patch,
    };
    return { runtime, spawned };
  }

  // createdAt must be ~now: the sink floors delivery at construction time so
  // a previous session's inbox never replays as popups.
  const delivery = {
    dedupKey: "dl:9",
    kind: "download-complete" as const,
    title: "Demo S1E2 ready",
    body: "Saved to the offline library",
    createdAt: new Date().toISOString(),
  };

  test("os sink spawns notify-send on Linux with argv-separated title and body", () => {
    const { runtime, spawned } = fakeRuntime({ platform: "linux" });
    const sink = new OsNotificationSink(runtime);
    sink.deliver(delivery);
    expect(spawned).toEqual([
      {
        command: ["/usr/bin/notify-send", "-a", "Kunai", delivery.title, delivery.body],
        env: undefined,
      },
    ]);
  });

  test("os sink passes title/body through argv (not -e source) on macOS", () => {
    const { runtime, spawned } = fakeRuntime({
      platform: "darwin",
      which: (command) => (command === "osascript" ? `/usr/bin/${command}` : null),
    });
    const sink = new OsNotificationSink(runtime);
    sink.deliver({ ...delivery, title: 'Quoted "title"' });
    const [call] = spawned;
    expect(call?.command[0]).toBe("/usr/bin/osascript");
    // The script text is fixed; user content travels in argv after `--`.
    const separator = call?.command.indexOf("--") ?? -1;
    expect(call?.command.slice(separator + 1)).toEqual([delivery.body, 'Quoted "title"']);
  });

  test("os sink uses an encoded PowerShell toast with env-carried content on Windows", () => {
    const { runtime, spawned } = fakeRuntime({
      platform: "win32",
      which: (command) => (command === "powershell.exe" ? `C:\\ps\\${command}` : null),
    });
    const sink = new OsNotificationSink(runtime);
    sink.deliver(delivery);
    const [call] = spawned;
    expect(call?.command[0]).toContain("powershell.exe");
    expect(call?.command).toContain("-EncodedCommand");
    // Title/body travel via env so the encoded script needs no interpolation.
    expect(call?.env?.KUNAI_NOTIFY_TITLE).toBe(delivery.title);
    expect(call?.env?.KUNAI_NOTIFY_BODY).toBe(delivery.body);
    // argv must never carry the payload — it is how a quote in a title would
    // otherwise reach PowerShell as syntax.
    expect(call?.command.some((arg) => arg.includes(delivery.title))).toBe(false);
  });

  test("os sink does not re-pop a dedupKey the service replays", () => {
    // emitChange() re-delivers every active record on each mutation; without
    // sink-side dedup a markRead would re-notify for unrelated items.
    const { runtime, spawned } = fakeRuntime();
    const sink = new OsNotificationSink(runtime);
    sink.deliver(delivery);
    sink.deliver(delivery);
    sink.deliver(delivery);
    expect(spawned).toHaveLength(1);

    sink.dismiss(delivery.dedupKey);
    sink.deliver(delivery);
    expect(spawned).toHaveLength(2);
  });

  test("os sink tolerates a missing notifier binary and a throwing spawn", () => {
    const missing = fakeRuntime({ which: () => null });
    const sink = new OsNotificationSink(missing.runtime);
    expect(() => sink.deliver(delivery)).not.toThrow();
    expect(missing.spawned).toHaveLength(0);

    const throwing = fakeRuntime({
      spawn: () => {
        throw new Error("ENOENT");
      },
    });
    const sink2 = new OsNotificationSink(throwing.runtime);
    expect(() => sink2.deliver(delivery)).not.toThrow();

    // Unsupported platform: nothing resolves, nothing throws.
    const other = fakeRuntime({ platform: "freebsd" });
    const sink3 = new OsNotificationSink(other.runtime);
    expect(() => sink3.deliver(delivery)).not.toThrow();
    expect(other.spawned).toHaveLength(0);
  });

  test("os sink stays silent for notifications recorded before this session", () => {
    const { runtime, spawned } = fakeRuntime();
    const sink = new OsNotificationSink(
      runtime,
      () => true,
      () => Date.parse("2026-06-01T00:00:00.000Z"),
    );
    sink.deliver({ ...delivery, createdAt: "2026-05-14T00:00:00.000Z" });
    expect(spawned).toHaveLength(0);
    // …while one created moments ago still pops.
    sink.deliver({ ...delivery, dedupKey: "dl:10", createdAt: "2026-06-01T00:00:00.000Z" });
    expect(spawned).toHaveLength(1);
  });

  test("os sink honors the KUNAI_DESKTOP_NOTIFICATIONS kill switch", () => {
    expect(areDesktopNotificationsEnabled({})).toBe(true);
    expect(areDesktopNotificationsEnabled({ KUNAI_DESKTOP_NOTIFICATIONS: "1" })).toBe(true);
    expect(areDesktopNotificationsEnabled({ KUNAI_DESKTOP_NOTIFICATIONS: "0" })).toBe(false);
    expect(areDesktopNotificationsEnabled({ KUNAI_DESKTOP_NOTIFICATIONS: "off" })).toBe(false);

    const { runtime, spawned } = fakeRuntime();
    const sink = new OsNotificationSink(runtime, () => false);
    sink.deliver(delivery);
    expect(spawned).toHaveLength(0);
  });
});
