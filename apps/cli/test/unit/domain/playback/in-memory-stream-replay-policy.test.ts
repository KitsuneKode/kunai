import { describe, expect, test } from "bun:test";

import {
  isStreamTimestampFresh,
  MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS,
} from "@/domain/playback/in-memory-stream-replay-policy";

describe("in-memory stream replay policy", () => {
  test("accepts streams within the replay window", () => {
    const now = 1_700_000_000_000;
    expect(
      isStreamTimestampFresh({ timestamp: now - MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS }, now),
    ).toBe(true);
    expect(
      isStreamTimestampFresh({ timestamp: now - MAX_IN_MEMORY_STREAM_REPLAY_AGE_MS - 1 }, now),
    ).toBe(false);
  });

  test("rejects missing or zero timestamps", () => {
    const now = 1_700_000_000_000;
    expect(isStreamTimestampFresh({ timestamp: 0 }, now)).toBe(false);
    expect(isStreamTimestampFresh({ timestamp: undefined as never }, now)).toBe(false);
  });
});
