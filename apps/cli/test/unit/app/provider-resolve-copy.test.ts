import { describe, expect, test } from "bun:test";

import {
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
  describeProviderResolveProviderNote,
} from "@/app/provider-resolve-copy";

describe("provider resolve copy", () => {
  test("does not talk about skipping retries on the first attempt", () => {
    expect(
      describeProviderResolveAttemptDetail({
        providerName: "VidKing",
        attempt: 1,
        maxAttempts: 3,
      }),
    ).toBe("Resolving via VidKing (1/3)");

    expect(describeProviderResolveAttemptNote({ attempt: 1, maxAttempts: 3 })).toBe(
      "Kunai will retry recoverable provider failures before fallback.",
    );
  });

  test("only offers skipping remaining retries once a retry is actually active", () => {
    expect(describeProviderResolveAttemptNote({ attempt: 2, maxAttempts: 3 })).toBe(
      "f skips the remaining retries and tries the next provider.",
    );
    expect(describeProviderResolveAttemptNote({ attempt: 3, maxAttempts: 3 })).toBe(
      "Final retry for this provider; fallback remains available.",
    );
  });

  test("uses provider-level copy before attempt details arrive", () => {
    expect(describeProviderResolveProviderNote(false)).toBe(
      "Recoverable provider failures retry before fallback.",
    );
    expect(describeProviderResolveProviderNote(true)).toBe(
      "Trying the next compatible provider now.",
    );
  });
});
