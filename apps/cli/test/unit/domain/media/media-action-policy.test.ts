import { expect, test } from "bun:test";

import { getMediaActions } from "@/domain/media/media-action-policy";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

const item: MediaItemIdentity = {
  mediaKind: "series",
  sourceId: "tmdb",
  titleId: "tmdb:100",
  title: "Example",
  season: 1,
  episode: 6,
  providerHints: [{ providerId: "vidking" }],
};

test("playback-active notification actions avoid hijacking playback", () => {
  const actions = getMediaActions({
    item,
    context: {
      surface: "notification",
      playbackActive: true,
      downloadsEnabled: true,
      playlistsEnabled: true,
      followEnabled: true,
      canDismiss: true,
    },
  }).map((action) => action.id);

  expect(actions).not.toContain("play-now");
  expect(actions).toContain("queue-next");
  expect(actions).toContain("queue-after-current-chain");
  expect(actions).toContain("queue-end");
  expect(actions).toContain("add-to-up-next");
  expect(actions).toContain("download");
  expect(actions).toContain("dismiss");
});

test("idle surfaces can play now and still expose durable actions", () => {
  const actions = getMediaActions({
    item,
    context: {
      surface: "history",
      playbackActive: false,
      downloadsEnabled: true,
      playlistsEnabled: true,
      followEnabled: true,
      canDismiss: false,
    },
  }).map((action) => action.id);

  expect(actions[0]).toBe("play-now");
  expect(actions).toContain("queue-end");
  expect(actions).toContain("add-to-watchlist");
  expect(actions).toContain("add-to-playlist");
  expect(actions).toContain("follow");
  expect(actions).not.toContain("unfollow");
  expect(actions).not.toContain("dismiss");
});

test("attention actions respect explicit follow preference", () => {
  const following = getMediaActions({
    item,
    context: {
      surface: "history",
      playbackActive: false,
      downloadsEnabled: true,
      playlistsEnabled: true,
      followEnabled: true,
      canDismiss: false,
      followPreference: "following",
    },
  }).map((action) => action.id);

  expect(following).toContain("unfollow");
  expect(following).toContain("mute");
  expect(following).not.toContain("follow");

  const muted = getMediaActions({
    item,
    context: {
      surface: "history",
      playbackActive: false,
      downloadsEnabled: true,
      playlistsEnabled: true,
      followEnabled: true,
      canDismiss: false,
      followPreference: "muted",
    },
  }).map((action) => action.id);

  expect(muted).toContain("unmute");
  expect(muted).not.toContain("mute");
  expect(muted).not.toContain("follow");
  expect(muted).not.toContain("unfollow");

  const mutedActions = getMediaActions({
    item,
    context: {
      surface: "history",
      playbackActive: false,
      downloadsEnabled: true,
      playlistsEnabled: true,
      followEnabled: true,
      canDismiss: false,
      followPreference: "muted",
    },
  });
  expect(mutedActions.find((action) => action.id === "unmute")?.label).toBe(
    "Unmute release notices",
  );
});
