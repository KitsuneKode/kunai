import { describe, expect, test } from "bun:test";

import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { defaultNotificationActionIds } from "@/services/notifications/NotificationService";

const EPISODE_ITEM: MediaItemIdentity = {
  mediaKind: "series",
  contentType: "series",
  titleId: "tmdb:1",
  title: "Example",
  season: 1,
  episode: 2,
};

const ANIME_EPISODE_ITEM: MediaItemIdentity = {
  mediaKind: "anime",
  titleId: "anilist:9",
  title: "Example Anime",
  absoluteEpisode: 13,
};

const TITLE_ONLY_ITEM: MediaItemIdentity = {
  mediaKind: "series",
  contentType: "series",
  titleId: "tmdb:2",
  title: "Title Only",
};

/**
 * `defaultNotificationActionIds` is the only writer of `actionJson`, and the
 * inbox filters its executable action catalogue against what is stored there.
 * So anything missing here is unreachable in the UI no matter how complete its
 * handler is — the reason "we have notifications but can't play from them".
 */
describe("defaultNotificationActionIds", () => {
  test("a new episode can be played and opened, not just queued", () => {
    const actions = defaultNotificationActionIds({ kind: "new-episode", item: EPISODE_ITEM });
    expect(actions).toContain("play-now");
    expect(actions).toContain("open-details");
    // Enter picks the first non-dismiss action, so play must lead.
    expect(actions[0]).toBe("play-now");
    expect(actions).toContain("dismiss");
  });

  test("an anime episode is playable from its absolute coordinate alone", () => {
    const actions = defaultNotificationActionIds({
      kind: "new-episode",
      item: ANIME_EPISODE_ITEM,
    });
    expect(actions[0]).toBe("play-now");
  });

  test("a completed download can play the file that just finished", () => {
    const actions = defaultNotificationActionIds({
      kind: "download-complete",
      item: EPISODE_ITEM,
    });
    expect(actions[0]).toBe("play-now");
    expect(actions).toContain("open-details");
  });

  test("a failed download offers a retry first", () => {
    const actions = defaultNotificationActionIds({
      kind: "download-failed",
      item: EPISODE_ITEM,
    });
    expect(actions[0]).toBe("retry-download");
    expect(actions).not.toContain("play-now");
  });

  test("a title-only identity falls back to details instead of a dead play", () => {
    const actions = defaultNotificationActionIds({ kind: "new-episode", item: TITLE_ONLY_ITEM });
    expect(actions).not.toContain("play-now");
    expect(actions).toContain("open-details");
    expect(actions[0]).toBe("open-details");
  });

  test("playback is never offered without a media identity to play", () => {
    for (const kind of ["new-episode", "download-complete"]) {
      const actions = defaultNotificationActionIds({ kind });
      expect(actions, kind).not.toContain("play-now");
      expect(actions, kind).not.toContain("open-details");
    }
  });

  test("queue-recovery and app-update keep their single purpose", () => {
    expect(defaultNotificationActionIds({ kind: "queue-recovery" })).toEqual([
      "restore-queue",
      "dismiss",
    ]);
    expect(defaultNotificationActionIds({ kind: "app-update" })).toEqual(["update-app", "dismiss"]);
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
      for (const item of [EPISODE_ITEM, TITLE_ONLY_ITEM, undefined]) {
        const emitted = defaultNotificationActionIds({ kind, item });
        const executable = getExecutableNotificationActions({
          kind,
          actionJson: JSON.stringify(emitted),
          itemJson: item === undefined ? undefined : JSON.stringify(item),
        } as never);
        // An id the overlay cannot run is dead weight that silently disappears.
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        expect(executable, `${kind} item=${item ? "set" : "none"}`).toEqual(emitted as never);
      }
    }
  });
});
