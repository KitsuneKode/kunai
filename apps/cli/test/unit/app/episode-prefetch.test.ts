import { expect, test } from "bun:test";

import {
  episodePrefetchKey,
  EpisodePrefetchHandle,
  isEpisodePrefetchEligible,
  matchesEpisodePrefetchTarget,
  type EpisodePrefetchBundle,
} from "@/app/playback/episode-prefetch";

const target = {
  titleId: "tmdb:1",
  episode: { season: 1, episode: 2 },
  providerId: "videasy",
};

test("offline playback is never eligible for provider prefetch", () => {
  expect(
    isEpisodePrefetchEligible({
      titleType: "series",
      hasNextEpisode: true,
      stopAfterCurrent: false,
      sessionMode: "autoplay-chain",
      autoplayPaused: false,
      networkAllowed: false,
    }),
  ).toBe(false);
});

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

test("prefetch bundle preserves resolved provider identity through consume", async () => {
  const handle = new EpisodePrefetchHandle();
  const bundle = createBundle({ resolvedProviderId: "rivestream" });

  handle.schedule(target, async () => bundle);
  await Promise.resolve();

  expect(handle.takeReadyFor(target)?.resolvedProviderId).toBe("rivestream");
});

test("prefetch never aliases provider-native episodes at the same UI index", async () => {
  const nativeZero = {
    ...target,
    episode: {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "0" },
    },
  };
  const nativeOne = {
    ...target,
    episode: {
      season: 1,
      episode: 1,
      providerEpisodeIdentity: { providerId: "allanime", value: "1" },
    },
  };
  const handle = new EpisodePrefetchHandle();
  const bundle = createBundle({ target: nativeZero });

  handle.schedule(nativeZero, async () => bundle);
  await Promise.resolve();

  expect(episodePrefetchKey(nativeZero.titleId, nativeZero.episode)).not.toBe(
    episodePrefetchKey(nativeOne.titleId, nativeOne.episode),
  );
  expect(matchesEpisodePrefetchTarget(nativeZero, nativeOne)).toBe(false);
  expect(handle.takeReadyFor(nativeOne)).toBeNull();
  expect(handle.takeReadyFor(nativeZero)).toEqual(bundle);
});

function createBundle(overrides?: Partial<EpisodePrefetchBundle>): EpisodePrefetchBundle {
  return {
    target,
    stream: { url: "https://cdn.example/ep2.mp4", headers: {}, timestamp: 1 },
    prepared: true,
    resolvedProviderId: target.providerId,
    ...overrides,
  };
}
