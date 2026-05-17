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
