import { describe, expect, test } from "bun:test";

import {
  computeInProcessReconnectSeek,
  isSameUrlRetryWorthwhile,
} from "@/infra/player/mpv-in-process-reconnect";

describe("computeInProcessReconnectSeek", () => {
  test("does not seek when duration is unknown (live-style)", () => {
    expect(computeInProcessReconnectSeek(120, 0)).toEqual({
      seekSeconds: 120,
      shouldSeek: false,
    });
    expect(computeInProcessReconnectSeek(30, NaN)).toEqual({
      seekSeconds: 30,
      shouldSeek: false,
    });
  });

  test("seeks within reported duration for VOD-like durations", () => {
    expect(computeInProcessReconnectSeek(400, 2000)).toEqual({
      seekSeconds: 400,
      shouldSeek: true,
    });
    expect(computeInProcessReconnectSeek(1999.9, 2000)).toEqual({
      seekSeconds: 1999.5,
      shouldSeek: true,
    });
  });
});

describe("isSameUrlRetryWorthwhile", () => {
  test("a URL that cannot be opened, or holds no playable media, is not reloaded", () => {
    for (const error of [
      "loading failed",
      "unrecognized file format",
      "no audio or video data played",
      "Loading Failed ",
    ]) {
      expect(isSameUrlRetryWorthwhile(error)).toBe(false);
    }
  });

  test("other errors, or none reported, may still recover on a reload", () => {
    expect(isSameUrlRetryWorthwhile(undefined)).toBe(true);
    expect(isSameUrlRetryWorthwhile("something happened")).toBe(true);
  });
});
