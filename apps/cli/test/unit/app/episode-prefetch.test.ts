import { describe, expect, test } from "bun:test";

import {
  EpisodePrefetchHandle,
  EPISODE_PREFETCH_WAIT_BUDGET_MS,
  isEpisodePrefetchEligible,
  matchesEpisodePrefetchTarget,
  resolveEpisodePrefetchWaitBudget,
} from "@/app/episode-prefetch";
import type { EpisodeInfo, StreamInfo } from "@/domain/types";

const ep = (season: number, episode: number): EpisodeInfo => ({ season, episode });

const mockStream = (url: string): StreamInfo => ({
  url,
  headers: {},
  timestamp: Date.now(),
});

const target = {
  titleId: "show-1",
  episode: ep(1, 2),
  providerId: "prov-a",
  sourceId: "source-a",
  streamId: "stream-a",
  audioPreference: "original",
  qualityPreference: "1080p",
  startupPriority: "balanced" as const,
  subtitlePreference: "en",
};

describe("episode prefetch eligibility", () => {
  test("allows manual mode when next episode exists", () => {
    expect(
      isEpisodePrefetchEligible({
        titleType: "series",
        hasNextEpisode: true,
        stopAfterCurrent: false,
        sessionMode: "manual",
        autoplayPaused: false,
      }),
    ).toBe(true);
  });

  test("blocks when autoplay chain is user-paused", () => {
    expect(
      isEpisodePrefetchEligible({
        titleType: "series",
        hasNextEpisode: true,
        stopAfterCurrent: false,
        sessionMode: "autoplay-chain",
        autoplayPaused: true,
      }),
    ).toBe(false);
  });
});

describe("EpisodePrefetchHandle", () => {
  test("returns ready bundle without waiting when prefetch completed", async () => {
    const handle = new EpisodePrefetchHandle();
    const bundle = {
      target,
      stream: mockStream("https://example.com/v.m3u8"),
      prepared: true,
    };

    handle.schedule(target, async () => bundle);
    await handle.awaitFor(target, async () => bundle, EPISODE_PREFETCH_WAIT_BUDGET_MS);

    const wait = await handle.awaitFor(target, async () => null, 100);
    expect(wait.outcome).toBe("ready");
    expect(wait.bundle?.stream.url).toBe("https://example.com/v.m3u8");
    expect(wait.waitedMs).toBe(0);
  });

  test("cancels in-flight prefetch on user navigation", async () => {
    const handle = new EpisodePrefetchHandle();
    let aborted = false;

    handle.schedule(target, async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
      return {
        target,
        stream: mockStream("https://example.com/late.m3u8"),
        prepared: true,
      };
    });

    handle.cancel("user-navigation");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(aborted).toBe(true);
    expect(handle.hasReadyFor(target)).toBe(false);
  });

  test("urgent awaitFor schedules work when prefetch never started", async () => {
    const handle = new EpisodePrefetchHandle();
    const wait = await handle.awaitFor(
      target,
      async () => ({
        target,
        stream: mockStream("https://example.com/urgent.m3u8"),
        prepared: false,
      }),
      2_000,
    );
    expect(wait.bundle?.stream.url).toBe("https://example.com/urgent.m3u8");
    expect(wait.outcome).toBe("completed");
  });

  test("takeReadyFor returns and clears a matching prepared bundle", async () => {
    const handle = new EpisodePrefetchHandle();
    const bundle = {
      target,
      stream: mockStream("https://example.com/take.m3u8"),
      prepared: true,
    };
    handle.schedule(target, async () => bundle);
    await handle.awaitFor(target, async () => bundle, 2_000);
    const taken = handle.takeReadyFor(target);
    expect(taken?.stream.url).toContain("take.m3u8");
    expect(handle.hasReadyFor(target)).toBe(false);
  });

  test("exact-match adoption rejects changed provider, stream, audio, quality, or startup intent", () => {
    expect(matchesEpisodePrefetchTarget(target, target)).toBe(true);
    expect(matchesEpisodePrefetchTarget(target, { ...target, episode: ep(1, 3) })).toBe(false);
    expect(matchesEpisodePrefetchTarget(target, { ...target, providerId: "prov-b" })).toBe(false);
    expect(matchesEpisodePrefetchTarget(target, { ...target, streamId: "stream-b" })).toBe(false);
    expect(matchesEpisodePrefetchTarget(target, { ...target, audioPreference: "dub" })).toBe(false);
    expect(matchesEpisodePrefetchTarget(target, { ...target, qualityPreference: "720p" })).toBe(
      false,
    );
    expect(
      matchesEpisodePrefetchTarget(target, { ...target, startupPriority: "quality-first" }),
    ).toBe(false);
  });

  test("startupPriority undefined matches the defaulted 'balanced' (no spurious prefetch miss)", () => {
    // target.startupPriority is "balanced". A request that omits it (undefined →
    // effective "balanced") must still adopt the prefetch — otherwise every advance
    // silently re-resolves and the next episode pauses.
    expect(matchesEpisodePrefetchTarget(target, { ...target, startupPriority: undefined })).toBe(
      true,
    );
    expect(matchesEpisodePrefetchTarget({ ...target, startupPriority: undefined }, target)).toBe(
      true,
    );
  });

  test("soft subtitle changes reuse video but mark subtitle preparation stale", async () => {
    const handle = new EpisodePrefetchHandle();
    const bundle = { target, stream: mockStream("https://example.com/sub.m3u8"), prepared: true };
    handle.schedule(target, async () => bundle);
    await handle.awaitFor(target, async () => bundle, 2_000);

    const adopted = handle.takeReadyFor({ ...target, subtitlePreference: "es" });

    expect(adopted?.stream.url).toContain("sub.m3u8");
    expect(adopted?.prepared).toBe(false);
  });

  test("wait budget extends only when video-readiness progress exists", () => {
    expect(resolveEpisodePrefetchWaitBudget()).toBe(3_000);
    expect(resolveEpisodePrefetchWaitBudget({ timingReady: true })).toBe(3_000);
    expect(resolveEpisodePrefetchWaitBudget({ sourceInventoryHit: true })).toBe(8_000);
    expect(resolveEpisodePrefetchWaitBudget({ providerResolveActive: true })).toBe(8_000);
    expect(resolveEpisodePrefetchWaitBudget({ fallbackAttemptStarted: true })).toBe(8_000);
  });
});
