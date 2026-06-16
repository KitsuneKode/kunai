import { expect, test } from "bun:test";

import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { MediaActionRouter } from "@/services/media-actions/MediaActionRouter";

const item: MediaItemIdentity = {
  mediaKind: "series",
  sourceId: "tmdb",
  titleId: "tmdb:1",
  title: "Example",
  season: 1,
  episode: 2,
};

test("queue action delegates to queue service without playing immediately", async () => {
  const calls: string[] = [];
  const router = new MediaActionRouter({
    queue: {
      enqueueMediaItem: async () => {
        calls.push("queue");
      },
    },
    playback: {
      playNow: async () => {
        calls.push("play");
      },
    },
  });

  await router.run({ actionId: "queue-next", item, source: "notification" });

  expect(calls).toEqual(["queue"]);
});

test("mark-watched delegates to the history port with the item", async () => {
  const marked: MediaItemIdentity[] = [];
  const router = new MediaActionRouter({
    history: {
      markWatched: async (target) => {
        marked.push(target);
      },
    },
  });

  await router.run({ actionId: "mark-watched", item, source: "episode-picker" });

  expect(marked).toEqual([item]);
});

test("mark-unwatched delegates to the history port with the item", async () => {
  const unmarked: MediaItemIdentity[] = [];
  const router = new MediaActionRouter({
    history: {
      markWatched: async () => {},
      markUnwatched: async (target) => {
        unmarked.push(target);
      },
    },
  });

  await router.run({ actionId: "mark-unwatched", item, source: "history" });

  expect(unmarked).toEqual([item]);
});

test("play now requires explicit confirmation while playback is active", async () => {
  const router = new MediaActionRouter({
    queue: { enqueueMediaItem: async () => {} },
    playback: { playNow: async () => {} },
  });

  await expect(
    router.run({
      actionId: "play-now",
      item,
      source: "notification",
      playbackActive: true,
      confirmedContextSwitch: false,
    }),
  ).rejects.toThrow("requires confirmation");
});

test("recommendation downloads require explicit provider resolution confirmation", async () => {
  const calls: string[] = [];
  const router = new MediaActionRouter({
    downloads: {
      queueDownload: async () => {
        calls.push("download");
      },
    },
  });

  await expect(
    router.run({
      actionId: "download",
      item,
      source: "post-playback-recommendation",
    }),
  ).rejects.toThrow("requires provider resolution confirmation");

  await router.run({
    actionId: "download",
    item,
    source: "post-playback-recommendation",
    confirmedProviderResolution: true,
  });

  expect(calls).toEqual(["download"]);
});

test("durable media actions delegate to their owning services", async () => {
  const calls: string[] = [];
  const router = new MediaActionRouter({
    playlists: {
      addToPlaylist: async () => {
        calls.push("playlist");
      },
    },
    attention: {
      follow: async () => {
        calls.push("follow");
      },
      mute: async () => {
        calls.push("mute");
      },
    },
    details: {
      open: async () => {
        calls.push("details");
      },
    },
  });

  await router.run({ actionId: "add-to-playlist", item, source: "history" });
  await router.run({ actionId: "follow", item, source: "history" });
  await router.run({ actionId: "mute", item, source: "history" });
  await router.run({ actionId: "open-details", item, source: "history" });

  expect(calls).toEqual(["playlist", "follow", "mute", "details"]);
});

test("unsupported media actions fail clearly instead of silently doing nothing", async () => {
  const router = new MediaActionRouter({});

  await expect(router.run({ actionId: "queue-end", item, source: "history" })).rejects.toThrow(
    "media action is unavailable: queue-end",
  );
});
