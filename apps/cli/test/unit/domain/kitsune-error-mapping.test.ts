import { describe, expect, test } from "bun:test";

import {
  kitsuneErrorFromProviderFailure,
  kitsuneErrorFromUnknown,
} from "@/domain/kitsune-error-mapping";

describe("kitsune-error-mapping", () => {
  test("maps provider failure classes to Kitsune error codes", () => {
    const error = kitsuneErrorFromProviderFailure({
      code: "network-error",
      message: "fetch failed",
      retryable: true,
    });
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.retryable).toBe(true);
  });

  test("falls back to provided defaults for plain errors", () => {
    const error = kitsuneErrorFromUnknown(new Error("boom"), {
      code: "PLAYER_FAILED",
      message: "Playback failed",
      retryable: false,
    });
    expect(error.code).toBe("PLAYER_FAILED");
    expect(error.message).toBe("boom");
    expect(error.retryable).toBe(false);
  });

  test("uses fallback message for non-error unknown values", () => {
    const error = kitsuneErrorFromUnknown("nope", {
      code: "NETWORK_ERROR",
      message: "Search failed",
      service: "tmdb",
      retryable: true,
    });
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toBe("Search failed");
    expect(error.service).toBe("tmdb");
  });
});
