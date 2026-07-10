import { describe, expect, test } from "bun:test";

import { readCancellationReason } from "@/services/playback/PlaybackResolveService";

describe("readCancellationReason", () => {
  test("prefers live ref current over snapshot cancellationReason", () => {
    expect(
      readCancellationReason({
        cancellationReason: "user-shutdown",
        cancellationReasonRef: { current: "user-navigation" },
      }),
    ).toBe("user-navigation");
  });

  test("falls back to snapshot when ref current is unset", () => {
    expect(
      readCancellationReason({
        cancellationReason: "timeout-budget",
        cancellationReasonRef: { current: undefined },
      }),
    ).toBe("timeout-budget");
  });

  test("sees late updates through the shared ref", () => {
    const cancellationReasonRef = { current: undefined as undefined | "user-navigation" };
    const input = { cancellationReasonRef };
    expect(readCancellationReason(input)).toBeUndefined();
    cancellationReasonRef.current = "user-navigation";
    expect(readCancellationReason(input)).toBe("user-navigation");
  });
});
