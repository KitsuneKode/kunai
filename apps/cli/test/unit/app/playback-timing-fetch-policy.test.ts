import { expect, test } from "bun:test";

import { shouldFetchPlaybackTiming } from "@/app/playback/playback-timing-fetch-policy";

test("offline playback never fetches remote timing metadata", () => {
  expect(
    shouldFetchPlaybackTiming({
      networkAllowed: false,
      hasTiming: false,
    }),
  ).toBe(false);
});

test("online playback retries when timing metadata is absent", () => {
  expect(
    shouldFetchPlaybackTiming({
      networkAllowed: true,
      hasTiming: false,
    }),
  ).toBe(true);
});

test("existing timing metadata suppresses a remote retry", () => {
  expect(
    shouldFetchPlaybackTiming({
      networkAllowed: true,
      hasTiming: true,
    }),
  ).toBe(false);
});
