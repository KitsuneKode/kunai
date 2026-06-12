import { expect, test } from "bun:test";

import { EpisodePrefetchHandle, type EpisodePrefetchBundle } from "@/app/episode-prefetch";

const target = {
  titleId: "tmdb:1",
  episode: { season: 1, episode: 2 },
  providerId: "videasy",
};

test("suspend keeps in-flight resolve and ready bundle", async () => {
  const handle = new EpisodePrefetchHandle();
  const bundle = createBundle();
  let finishResolve!: () => void;
  const resolveGate = new Promise<void>((resolve) => {
    finishResolve = resolve;
  });
  let runDone!: Promise<EpisodePrefetchBundle>;

  handle.schedule(target, () => {
    runDone = resolveGate.then(() => bundle);
    return runDone;
  });
  await Promise.resolve();

  handle.suspend("post-playback-menu");
  finishResolve();
  await runDone;
  await Promise.resolve();

  expect(handle.takeReadyFor(target)).toEqual(bundle);
});

test("suspend does not abort in-flight resolve", async () => {
  const handle = new EpisodePrefetchHandle();
  const bundle = createBundle();
  let signalSeen: AbortSignal | undefined;

  handle.schedule(target, async (signal) => {
    signalSeen = signal;
    return bundle;
  });
  handle.suspend("post-playback-menu");
  await Promise.resolve();

  expect(signalSeen?.aborted).toBe(false);
});

test("cancel clears ready bundle", async () => {
  const handle = new EpisodePrefetchHandle();
  const bundle = createBundle();

  handle.schedule(target, async () => bundle);
  await Promise.resolve();
  handle.cancel("user-navigation");

  expect(handle.takeReadyFor(target)).toBeNull();
});

function createBundle() {
  return {
    target,
    stream: { url: "https://cdn.example/ep2.mp4", headers: {}, timestamp: 1 },
    prepared: true,
  };
}
