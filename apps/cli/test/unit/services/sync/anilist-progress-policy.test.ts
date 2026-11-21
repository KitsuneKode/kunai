import { describe, expect, test } from "bun:test";

import { decideAniListProgressWrite } from "@/services/sync/anilist-progress-policy";

const decide = (overrides: Partial<Parameters<typeof decideAniListProgressWrite>[0]>) =>
  decideAniListProgressWrite({
    progress: 3,
    episodeFinished: true,
    totalEpisodes: 12,
    remote: null,
    ...overrides,
  });

describe("decideAniListProgressWrite", () => {
  test("a finished middle episode is CURRENT progress", () => {
    expect(decide({})).toEqual({ write: true, status: "CURRENT", progress: 3 });
  });

  test("the finished last episode completes the title", () => {
    expect(decide({ progress: 12 })).toEqual({ write: true, status: "COMPLETED", progress: 12 });
  });

  test("a partly watched last episode does not complete the title", () => {
    expect(decide({ progress: 12, episodeFinished: false })).toMatchObject({ status: "CURRENT" });
  });

  test("an unknown or zero episode count never completes", () => {
    expect(decide({ progress: 40, totalEpisodes: null })).toMatchObject({ status: "CURRENT" });
    expect(decide({ progress: 1, totalEpisodes: 0 })).toMatchObject({ status: "CURRENT" });
  });

  test("a remote COMPLETED entry is never rewritten", () => {
    expect(decide({ remote: { status: "COMPLETED", progress: 12 } })).toEqual({
      write: false,
      reason: "remote-completed",
    });
    expect(decide({ progress: 12, remote: { status: "COMPLETED", progress: 12 } })).toMatchObject({
      write: false,
    });
  });

  test("remote progress at or past the episode is not wound back", () => {
    expect(decide({ remote: { status: "CURRENT", progress: 3 } })).toEqual({
      write: false,
      reason: "remote-ahead",
    });
    expect(decide({ remote: { status: "PAUSED", progress: 9 } })).toMatchObject({ write: false });
  });

  test("completing the title still writes when remote progress is level", () => {
    expect(decide({ progress: 12, remote: { status: "CURRENT", progress: 12 } })).toEqual({
      write: true,
      status: "COMPLETED",
      progress: 12,
    });
  });

  test("a rewatch keeps REPEATING until its last episode", () => {
    expect(decide({ progress: 5, remote: { status: "REPEATING", progress: 4 } })).toEqual({
      write: true,
      status: "REPEATING",
      progress: 5,
    });
    expect(decide({ progress: 12, remote: { status: "REPEATING", progress: 11 } })).toMatchObject({
      status: "COMPLETED",
    });
  });

  test("planning, paused and dropped entries move to CURRENT when progress advances", () => {
    for (const status of ["PLANNING", "PAUSED", "DROPPED"] as const) {
      expect(decide({ remote: { status, progress: 0 } })).toMatchObject({
        write: true,
        status: "CURRENT",
      });
    }
  });
});
