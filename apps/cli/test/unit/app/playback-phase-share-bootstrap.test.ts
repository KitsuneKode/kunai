import { describe, expect, test } from "bun:test";

import { createBootstrapResumeResolver } from "@/app/playback/playback-resume-from-history";
import type { EpisodeInfo } from "@/domain/types";

const ep = (season: number, episode: number): EpisodeInfo => ({ season, episode });

describe("createBootstrapResumeResolver (PlaybackPhase one-shot bootstrap)", () => {
  test("applies the shared timestamp only to the first resolved episode", () => {
    const historyByEpisode = new Map<string, number>([
      ["1:1", 30],
      ["1:2", 0],
    ]);
    const resolve = createBootstrapResumeResolver({
      sharedStartSeconds: 90,
      resumeFromHistory: (episode) =>
        historyByEpisode.get(`${episode.season}:${episode.episode}`) ?? 0,
    });

    // First episode: max(shared 90, history 30) => 90 (shared wins).
    expect(resolve(ep(1, 1))).toBe(90);
    // Second episode: bootstrap already consumed, falls back to plain history (0 here).
    expect(resolve(ep(1, 2))).toBe(0);
  });

  test("prefers history when it is further than the shared timestamp on first play", () => {
    const resolve = createBootstrapResumeResolver({
      sharedStartSeconds: 10,
      resumeFromHistory: () => 120,
    });
    expect(resolve(ep(1, 1))).toBe(120);
  });

  test("uses the shared timestamp on first play when there is no history", () => {
    const resolve = createBootstrapResumeResolver({
      sharedStartSeconds: 45,
      resumeFromHistory: () => 0,
    });
    expect(resolve(ep(2, 5))).toBe(45);
  });

  test("falls back to history resume for every episode when no shared timestamp is set", () => {
    const calls: EpisodeInfo[] = [];
    const resolve = createBootstrapResumeResolver({
      sharedStartSeconds: undefined,
      resumeFromHistory: (episode) => {
        calls.push(episode);
        return episode.episode === 1 ? 15 : 60;
      },
    });
    expect(resolve(ep(1, 1))).toBe(15);
    expect(resolve(ep(1, 2))).toBe(60);
    expect(calls).toHaveLength(2);
  });

  test("treats a zero shared timestamp as start-from-beginning on first play", () => {
    // shared is 0 -> resolveBootstrapStartSeconds returns undefined, so the first episode
    // starts from the beginning (0) and later episodes still resume from history.
    const resolve = createBootstrapResumeResolver({
      sharedStartSeconds: 0,
      resumeFromHistory: (episode) => (episode.episode === 2 ? 75 : 0),
    });
    expect(resolve(ep(1, 1))).toBe(0);
    expect(resolve(ep(1, 2))).toBe(75);
  });
});
