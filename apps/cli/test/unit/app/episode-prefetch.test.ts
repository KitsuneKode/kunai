import { describe, expect, test } from "bun:test";

import {
  EpisodePrefetchHandle,
  EPISODE_PREFETCH_WAIT_BUDGET_MS,
  isEpisodePrefetchEligible,
  matchesEpisodePrefetchTarget,
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
    const taken = handle.takeReadyFor(target.titleId, target.episode, target.providerId);
    expect(taken?.stream.url).toContain("take.m3u8");
    expect(handle.hasReadyFor(target)).toBe(false);
  });

  test("matchesEpisodePrefetchTarget compares season and episode", () => {
    expect(matchesEpisodePrefetchTarget(target, "show-1", ep(1, 2), "prov-a")).toBe(true);
    expect(matchesEpisodePrefetchTarget(target, "show-1", ep(1, 3), "prov-a")).toBe(false);
    expect(matchesEpisodePrefetchTarget(target, "show-1", ep(1, 2), "prov-b")).toBe(false);
  });
});
