import { describe, expect, test } from "bun:test";

import {
  summarizeRuntimeMemoryTrend,
  type RuntimeMemorySample,
} from "@/services/diagnostics/runtime-memory";

function sample(timestamp: number, totalMiB: number, heapMiB = 80): RuntimeMemorySample {
  return {
    timestamp,
    snapshot: {
      appRssBytes: totalMiB * 1024 * 1024,
      appHeapUsedBytes: heapMiB * 1024 * 1024,
      appHeapTotalBytes: 128 * 1024 * 1024,
      playbackChildRssBytes: 0,
      playbackChildSwapBytes: 0,
      playbackChildCount: 0,
    },
  };
}

describe("runtime memory trend", () => {
  test("waits for more than one sample before claiming a trend", () => {
    expect(summarizeRuntimeMemoryTrend([sample(1000, 256)])).toEqual({
      label: "Memory trend",
      detail: "collecting trend · 1 sample",
      tone: "neutral",
    });
  });

  test("keeps small movement calm across the sampled window", () => {
    expect(summarizeRuntimeMemoryTrend([sample(1000, 256), sample(31_000, 264)])).toEqual({
      label: "Memory trend",
      detail: "stable · +8.0 MiB over 30s",
      tone: "success",
    });
  });

  test("warns when memory grows quickly across recent samples", () => {
    expect(summarizeRuntimeMemoryTrend([sample(1000, 256), sample(31_000, 420, 190)])).toEqual({
      label: "Memory trend",
      detail: "growing · +164.0 MiB over 30s · heap +110.0 MiB",
      tone: "warning",
    });
  });
});
