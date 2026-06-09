import { expect, test } from "bun:test";

import { EpisodePrefetchHandle } from "@/app/episode-prefetch";

const target = {
  titleId: "tmdb:1",
  episode: { season: 1, episode: 2 },
  providerId: "videasy",
};

test("suspend keeps in-flight resolve and ready bundle", async () => {
  const handle = new EpisodePrefetchHandle();
  const bundle = {
    target,
    stream: { url: "https://cdn.example/ep2.mp4", headers: {}, timestamp: 1 },
    prepared: true,
  };

  handle.schedule(target, async () => {
    await Bun.sleep(5);
    return bundle;
  });
  handle.suspend("post-playback-menu");
  await Bun.sleep(10);

  expect(handle.takeReadyFor(target)).toEqual(bundle);
});

test("cancel clears ready bundle", async () => {
  const handle = new EpisodePrefetchHandle();
  const bundle = {
    target,
    stream: { url: "https://cdn.example/ep2.mp4", headers: {}, timestamp: 1 },
    prepared: true,
  };

  handle.schedule(target, async () => bundle);
  await Bun.sleep(0);
  handle.cancel("user-navigation");

  expect(handle.takeReadyFor(target)).toBeNull();
});
