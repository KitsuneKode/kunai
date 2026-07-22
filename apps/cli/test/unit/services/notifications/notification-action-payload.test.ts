import { describe, expect, test } from "bun:test";

import { defaultNotificationActionIds } from "@/services/notifications/NotificationService";

/**
 * `defaultNotificationActionIds` is the only writer of `actionJson`, and the
 * inbox filters its executable action catalogue against what is stored there.
 * So anything missing here is unreachable in the UI no matter how complete its
 * handler is — the reason "we have notifications but can't play from them".
 */
describe("defaultNotificationActionIds", () => {
  test("a new episode can be played and opened, not just queued", () => {
    const actions = defaultNotificationActionIds({ kind: "new-episode", hasItem: true });
    expect(actions).toContain("play-now");
    expect(actions).toContain("open-details");
    // Enter picks the first non-dismiss action, so play must lead.
    expect(actions[0]).toBe("play-now");
    expect(actions).toContain("dismiss");
  });

  test("a completed download can play the file that just finished", () => {
    const actions = defaultNotificationActionIds({ kind: "download-complete", hasItem: true });
    expect(actions[0]).toBe("play-now");
    expect(actions).toContain("open-details");
  });

  test("a failed download offers a retry first", () => {
    const actions = defaultNotificationActionIds({ kind: "download-failed", hasItem: true });
    expect(actions[0]).toBe("retry-download");
    expect(actions).not.toContain("play-now");
  });

  test("playback is never offered without a media identity to play", () => {
    for (const kind of ["new-episode", "download-complete"]) {
      const actions = defaultNotificationActionIds({ kind, hasItem: false });
      expect(actions, kind).not.toContain("play-now");
      expect(actions, kind).not.toContain("open-details");
    }
  });

  test("queue-recovery and app-update keep their single purpose", () => {
    expect(defaultNotificationActionIds({ kind: "queue-recovery", hasItem: false })).toEqual([
      "restore-queue",
      "dismiss",
    ]);
    expect(defaultNotificationActionIds({ kind: "app-update", hasItem: false })).toEqual([
      "update-app",
      "dismiss",
    ]);
  });

  test("every emitted action is one the inbox can actually execute", async () => {
    const { getExecutableNotificationActions } =
      await import("@/app-shell/notification-overlay-model");
    for (const kind of [
      "new-episode",
      "download-complete",
      "download-failed",
      "queue-recovery",
      "app-update",
    ]) {
      for (const hasItem of [true, false]) {
        const emitted = defaultNotificationActionIds({ kind, hasItem });
        const executable = getExecutableNotificationActions({
          actionJson: JSON.stringify(emitted),
        } as never);
        // An id the overlay cannot run is dead weight that silently disappears.
        expect(executable, `${kind} hasItem=${hasItem}`).toEqual(emitted as never);
      }
    }
  });
});
