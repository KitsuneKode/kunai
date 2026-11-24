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

test("background schedule rejection does not surface as an unhandled rejection", async () => {
  const handle = new EpisodePrefetchHandle();
  const unhandled: Error[] = [];
  const onUnhandled = (reason: Error) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    handle.schedule(target, async () => {
      throw new Error("provider boom");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.isInFlightFor(target)).toBe(false);
    expect(handle.hasReadyFor(target)).toBe(false);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("awaitFor clears its timeout timer when prefetch finishes first and marks subtitle mismatches unprepared", async () => {
  const handle = new EpisodePrefetchHandle();
  const prefetchedTarget = { ...target, subtitlePreference: "en" };
  const requestedTarget = { ...target, subtitlePreference: "ja" };
  const bundle = createBundle({ target: prefetchedTarget, prepared: true });

  let activeTimers = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  // SAFETY: test spy delegates directly to global setTimeout with identical parameters.
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    activeTimers += 1;
    return originalSetTimeout(...args);
  }) as typeof setTimeout;
  // SAFETY: test spy delegates directly to global clearTimeout with identical parameters.
  globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
    if (id !== undefined) activeTimers -= 1;
    return originalClearTimeout(id);
  }) as typeof clearTimeout;

  try {
    handle.schedule(prefetchedTarget, async () => bundle);
    const wait = await handle.awaitFor(requestedTarget, async () => bundle, 8_000);
    expect(wait.outcome).toBe("completed");
    expect(wait.bundle?.prepared).toBe(false);
    expect(wait.bundle?.target.subtitlePreference).toBe("ja");
    expect(activeTimers).toBe(0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
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
